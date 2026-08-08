import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { pool } from '../src/db/pool';

// The point of this feature: an admin can suspend a merchant and have it
// actually take effect immediately — not just on the merchant's next login,
// but against a session cookie that was already issued before the
// suspension happened. Same real-Postgres, no-mocks approach as
// critical-path.e2e-spec.ts.
describe('admin workflow: suspend/reactivate a merchant (e2e)', () => {
  let app: INestApplication;
  const adminEmail = `admin-e2e-${Date.now()}@example.com`;
  const merchantEmail = `merchant-e2e-${Date.now()}@example.com`;
  const stellarAddress = 'GBXBABMFZIJPTOFI6STUXA2FMEXDBB4URBD3VS5XDHKMFHGLJZ5WPQBB';
  let adminCookie: string;
  let merchantCookie: string;
  let merchantId: string;
  let linkId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    const passwordHash = await bcrypt.hash('an-admin-password-000', 10);
    await pool.query('INSERT INTO admins (email, password_hash, name) VALUES ($1, $2, $3)', [adminEmail, passwordHash, 'E2E Admin']);
  });

  afterAll(async () => {
    // Children before parents — withdrawal_attempts/payments/links all
    // reference merchants; blocked_addresses/admin_actions reference admins.
    await pool.query('DELETE FROM withdrawal_attempts WHERE merchant_id = (SELECT id FROM merchants WHERE email = $1)', [merchantEmail]);
    await pool.query('DELETE FROM payments WHERE merchant_id = (SELECT id FROM merchants WHERE email = $1)', [merchantEmail]);
    await pool.query('DELETE FROM links WHERE merchant_id = (SELECT id FROM merchants WHERE email = $1)', [merchantEmail]);
    await pool.query('DELETE FROM blocked_addresses WHERE blocked_by IN (SELECT id FROM admins WHERE email = $1)', [adminEmail]);
    await pool.query('DELETE FROM admin_actions WHERE admin_id IN (SELECT id FROM admins WHERE email = $1)', [adminEmail]);
    await pool.query('DELETE FROM admins WHERE email = $1', [adminEmail]);
    await pool.query('DELETE FROM merchants WHERE email = $1', [merchantEmail]);
    await app.close();
    await pool.end();
  });

  it('logs the admin in on a distinct cookie from the merchant session', async () => {
    const res = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send({ email: adminEmail, password: 'an-admin-password-000' })
      .expect(200);

    const rawCookie = res.headers['set-cookie']?.[0];
    expect(rawCookie).toContain('konfirm_admin_session=');
    adminCookie = rawCookie.split(';')[0];
  });

  it('rejects a merchant-facing route with the admin cookie', async () => {
    await request(app.getHttpServer()).get('/auth/me').set('Cookie', adminCookie).expect(401);
  });

  it('signs up a merchant and creates a payable link', async () => {
    const signupRes = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email: merchantEmail, password: 'a-real-password-000', name: 'E2E Merchant', stellar_base_address: stellarAddress })
      .expect(201);
    merchantId = signupRes.body.merchant.id;
    merchantCookie = signupRes.headers['set-cookie'][0].split(';')[0];

    const linkRes = await request(app.getHttpServer())
      .post('/links')
      .set('Cookie', merchantCookie)
      .send({ amount_usdc: '5.00', currency: 'XLM', description: 'e2e admin test link' })
      .expect(201);
    linkId = linkRes.body.id;
  });

  it('returns real aggregate stats, not fabricated ones', async () => {
    const res = await request(app.getHttpServer()).get('/admin/stats').set('Cookie', adminCookie).expect(200);
    expect(res.body.merchants.total).toBeGreaterThanOrEqual(1);
    expect(res.body.merchants.active + res.body.merchants.suspended + res.body.merchants.pending).toBe(res.body.merchants.total);
    // Always exactly 7 entries, zero-filled for days with no payments —
    // never a partial or ragged series for the chart to choke on.
    expect(res.body.daily_volume).toHaveLength(7);
    expect(res.body.daily_volume[6].date).toBe(new Date().toISOString().slice(0, 10));
    expect(res.body.compliance.blocked_count).toBeGreaterThanOrEqual(0);
    expect(res.body.withdrawals.open_count).toBeGreaterThanOrEqual(0);
  });

  it('lists the merchant via the admin API', async () => {
    const res = await request(app.getHttpServer()).get('/admin/merchants').set('Cookie', adminCookie).expect(200);
    expect(res.body.some((m: { email: string }) => m.email === merchantEmail)).toBe(true);
  });

  it('rejects the admin API with no admin session at all', async () => {
    await request(app.getHttpServer()).get('/admin/merchants').expect(401);
  });

  it('suspends the merchant, which instantly invalidates their existing session cookie', async () => {
    await request(app.getHttpServer())
      .patch(`/admin/merchants/${merchantId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'suspended', reason: 'e2e test' })
      .expect(200);

    // Same cookie as before — never re-issued — now rejected.
    await request(app.getHttpServer()).get('/auth/me').set('Cookie', merchantCookie).expect(401);
  });

  it("rejects checkout on the suspended merchant's link", async () => {
    const res = await request(app.getHttpServer())
      .get('/payments/prepare-tx')
      .query({ linkId, muxed_id: '555555555', payer: 'GDIET4T37N35XU4FY52RMR4Z653WYFITEHGIJXN4VEQTDYR5JSURJDPL' })
      .expect(400);
    expect(res.body.message).toMatch(/not currently accepting payments/);
  });

  it('logs the suspend action to the audit trail', async () => {
    const res = await request(app.getHttpServer()).get('/admin/activity').set('Cookie', adminCookie).expect(200);
    const entry = res.body.find((a: { target_id: string }) => a.target_id === merchantId);
    expect(entry).toBeDefined();
    expect(entry.action).toBe('merchant.suspend');
  });

  it('reactivating the merchant restores both login and checkout', async () => {
    await request(app.getHttpServer())
      .patch(`/admin/merchants/${merchantId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'active' })
      .expect(200);

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: merchantEmail, password: 'a-real-password-000' })
      .expect(200);
    const freshCookie = loginRes.headers['set-cookie'][0].split(';')[0];
    await request(app.getHttpServer()).get('/auth/me').set('Cookie', freshCookie).expect(200);

    await request(app.getHttpServer())
      .get('/payments/prepare-tx')
      .query({ linkId, muxed_id: '666666666', payer: 'GDIET4T37N35XU4FY52RMR4Z653WYFITEHGIJXN4VEQTDYR5JSURJDPL' })
      .expect(200);
  });

  describe('compliance: blocking an address takes precedence over the on-chain check', () => {
    const payer = 'GDIET4T37N35XU4FY52RMR4Z653WYFITEHGIJXN4VEQTDYR5JSURJDPL';
    let blockedId: string;

    it('blocks the address, which rejects checkout instantly (no chain call needed)', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/compliance/blocked-addresses')
        .set('Cookie', adminCookie)
        .send({ stellar_address: payer, reason: 'e2e compliance test' })
        .expect(201);
      blockedId = res.body.id;

      const prepRes = await request(app.getHttpServer())
        .get('/payments/prepare-tx')
        .query({ linkId, muxed_id: '777777777', payer })
        .expect(403);
      expect(prepRes.body.message).toMatch(/not permitted to pay/);
    });

    it('rejects a duplicate block with a real conflict, not a silent success', async () => {
      await request(app.getHttpServer())
        .post('/admin/compliance/blocked-addresses')
        .set('Cookie', adminCookie)
        .send({ stellar_address: payer })
        .expect(409);
    });

    it('unblocking restores checkout', async () => {
      await request(app.getHttpServer())
        .delete(`/admin/compliance/blocked-addresses/${blockedId}`)
        .set('Cookie', adminCookie)
        .expect(200);

      await request(app.getHttpServer())
        .get('/payments/prepare-tx')
        .query({ linkId, muxed_id: '888888888', payer })
        .expect(200);
    });
  });

  describe('payments: admin can review and change status', () => {
    let paymentId: string;

    beforeAll(async () => {
      // prepare-tx never creates a payments row (only the reconciler does,
      // after Horizon confirms a real signed transaction) — this e2e run
      // has no private key to sign with, so a row is inserted directly to
      // exercise the admin review endpoints against something real.
      const { rows } = await pool.query(
        `INSERT INTO payments (merchant_id, muxed_id, muxed_address, payer_address, asset_code, amount_usdc, net_usdc, paging_token, tx_hash, ledger_sequence)
         VALUES ($1, 999, 'M...e2e', $2, 'XLM', 5, 5, $3, 'e2e-tx-hash', 1)
         RETURNING id`,
        [merchantId, 'GDIET4T37N35XU4FY52RMR4Z653WYFITEHGIJXN4VEQTDYR5JSURJDPL', `e2e-paging-token-${Date.now()}`],
      );
      paymentId = rows[0].id;
    });

    it('lists it via the admin API', async () => {
      const res = await request(app.getHttpServer()).get('/admin/payments').set('Cookie', adminCookie).expect(200);
      expect(res.body.some((p: { id: string }) => p.id === paymentId)).toBe(true);
    });

    it('holds it, then releases it back to paid', async () => {
      const heldRes = await request(app.getHttpServer())
        .patch(`/admin/payments/${paymentId}/status`)
        .set('Cookie', adminCookie)
        .send({ status: 'held', reason: 'e2e review' })
        .expect(200);
      expect(heldRes.body.status).toBe('held');

      const filtered = await request(app.getHttpServer())
        .get('/admin/payments')
        .query({ status: 'held' })
        .set('Cookie', adminCookie)
        .expect(200);
      expect(filtered.body.some((p: { id: string }) => p.id === paymentId)).toBe(true);

      const paidRes = await request(app.getHttpServer())
        .patch(`/admin/payments/${paymentId}/status`)
        .set('Cookie', adminCookie)
        .send({ status: 'paid' })
        .expect(200);
      expect(paidRes.body.status).toBe('paid');
    });
  });

  describe('reconciler: cursor can only move backward', () => {
    let originalCursor: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer()).get('/admin/reconciler/status').set('Cookie', adminCookie).expect(200);
      originalCursor = res.body.value;
    });

    afterAll(async () => {
      // Restore whatever was there before this suite touched it — this is
      // a single shared, global row, not scoped to this test's own data.
      await pool.query(`UPDATE reconciler_state SET value = $1 WHERE key = 'cursor'`, [originalCursor]);
    });

    it('rejects a non-numeric, non-"now" value outright', async () => {
      await request(app.getHttpServer())
        .post('/admin/reconciler/rewind')
        .set('Cookie', adminCookie)
        .send({ cursor: 'not-a-real-cursor' })
        .expect(400);
    });

    it('accepts moving to a real position (from "now" or backward)', async () => {
      await request(app.getHttpServer()).post('/admin/reconciler/rewind').set('Cookie', adminCookie).send({ cursor: '1000' }).expect(201);
      await request(app.getHttpServer()).post('/admin/reconciler/rewind').set('Cookie', adminCookie).send({ cursor: '500' }).expect(201);
    });

    it('rejects jumping forward past the current position', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/reconciler/rewind')
        .set('Cookie', adminCookie)
        .send({ cursor: '999999999' })
        .expect(400);
      expect(res.body.message).toMatch(/backward/);
    });

    it('rejects jumping to "now" from a real position — that skips everything unprocessed', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/reconciler/rewind')
        .set('Cookie', adminCookie)
        .send({ cursor: 'now' })
        .expect(400);
      expect(res.body.message).toMatch(/skips every unprocessed payment/);
    });
  });

  describe('withdrawal attempts: admin visibility, never leaking the anchor token', () => {
    let attemptId: string;

    beforeAll(async () => {
      const { rows } = await pool.query(
        `INSERT INTO withdrawal_attempts (merchant_id, currency, anchor_tx_id, token) VALUES ($1, 'XLM', 'e2e-anchor-tx-id', 'e2e-fake-token')
         RETURNING id`,
        [merchantId],
      );
      attemptId = rows[0].id;
    });

    it('lists it with the merchant joined in, and never exposes the raw token', async () => {
      const res = await request(app.getHttpServer()).get('/admin/withdrawal-attempts').set('Cookie', adminCookie).expect(200);
      const entry = res.body.find((a: { id: string }) => a.id === attemptId);
      expect(entry).toBeDefined();
      expect(entry.merchant_email).toBe(merchantEmail);
      expect(entry.token).toBeUndefined();
    });
  });
});
