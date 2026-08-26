import { Injectable } from '@nestjs/common';
import { pool } from '../db/pool';

// "Activated" is computed (EXISTS a paid payment for the referred
// merchant), not a stored status column — see migration 014's comment for
// why: it can't drift out of sync with the reconciler, since there's
// nothing to keep in sync.
@Injectable()
export class AdminReferralsService {
  async list(limit = 50, offset = 0) {
    const { rows } = await pool.query(
      `SELECT r.id, r.code, r.created_at,
              referrer.id AS referrer_id, referrer.name AS referrer_name, referrer.email AS referrer_email,
              referred.id AS referred_id, referred.name AS referred_name, referred.email AS referred_email,
              EXISTS(SELECT 1 FROM payments p WHERE p.merchant_id = referred.id AND p.status = 'paid') AS activated
       FROM referrals r
       JOIN merchants referrer ON referrer.id = r.referrer_id
       JOIN merchants referred ON referred.id = r.referred_id
       ORDER BY r.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows;
  }
}
