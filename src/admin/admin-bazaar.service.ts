import { Injectable, NotFoundException } from '@nestjs/common';
import { pool } from '../db/pool';

@Injectable()
export class AdminBazaarService {
  async list(status?: string) {
    const { rows } = await pool.query(
      status
        ? `SELECT id, kind, name, url, description, network, scheme, contact_email, status, created_at, reviewed_at
           FROM bazaar_listings WHERE status = $1 ORDER BY created_at DESC`
        : `SELECT id, kind, name, url, description, network, scheme, contact_email, status, created_at, reviewed_at
           FROM bazaar_listings ORDER BY created_at DESC`,
      status ? [status] : [],
    );
    return rows;
  }

  async setStatus(id: string, status: 'approved' | 'rejected', adminId: string) {
    const { rows } = await pool.query(
      `UPDATE bazaar_listings SET status = $2, reviewed_by = $3, reviewed_at = NOW()
       WHERE id = $1 RETURNING id, kind, name, url, status`,
      [id, status, adminId],
    );
    if (rows.length === 0) throw new NotFoundException('listing not found');
    return rows[0];
  }
}
