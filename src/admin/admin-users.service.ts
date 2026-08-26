import { Injectable } from '@nestjs/common';
import { pool } from '../db/pool';

// No dedicated `users` table exists — every unique payments.payer_address is
// already, in effect, an end-user of the platform, just never surfaced as
// its own listing. This aggregates existing data rather than introducing
// new schema; volume/count spans every status (a user's own activity
// history, not a revenue figure — see AdminFeeRevenueService for the
// paid-only distinction that matters there but not here).
@Injectable()
export class AdminUsersService {
  async list(limit = 50, offset = 0) {
    const { rows } = await pool.query(
      `SELECT payer_address,
              COUNT(*) AS payment_count,
              COALESCE(SUM(amount_usdc), 0) AS total_volume_usdc,
              MIN(created_at) AS first_seen_at,
              MAX(created_at) AS last_seen_at,
              COUNT(*) FILTER (WHERE status = 'refunded') AS refunded_count,
              COUNT(*) FILTER (WHERE status = 'disputed') AS disputed_count
       FROM payments
       GROUP BY payer_address
       ORDER BY last_seen_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows;
  }
}
