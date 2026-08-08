import { Injectable } from '@nestjs/common';
import { pool } from '../db/pool';

// One generic audit log for every admin mutation, rather than a bespoke
// table per feature — "what did admins do and when" is always one query.
// Surfaced back to the admin UI as a recent-activity feed, not just written
// and forgotten.
@Injectable()
export class AdminActionsService {
  async log(adminId: string, action: string, targetType: string, targetId: string, detail?: Record<string, unknown>): Promise<void> {
    await pool.query(
      `INSERT INTO admin_actions (admin_id, action, target_type, target_id, detail)
       VALUES ($1, $2, $3, $4, $5)`,
      [adminId, action, targetType, targetId, detail ? JSON.stringify(detail) : null],
    );
  }

  async recent(limit = 20) {
    const { rows } = await pool.query(
      `SELECT aa.id, aa.action, aa.target_type, aa.target_id, aa.detail, aa.created_at, a.name AS admin_name
       FROM admin_actions aa
       JOIN admins a ON a.id = aa.admin_id
       ORDER BY aa.created_at DESC
       LIMIT $1`,
      [limit],
    );
    return rows;
  }
}
