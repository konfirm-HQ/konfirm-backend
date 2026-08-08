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
    await pool.query('DELETE FROM admin_actions WHERE admin_id IN (SELECT id FROM admins WHERE email = $1)', [adminEmail]);
    await pool.query('DELETE FROM admins WHERE email = $1', [adminEmail]);
    await pool.query('DELETE FROM links WHERE merchant_id = (SELECT id FROM merchants WHERE email = $1)', [merchantEmail]);
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
});
