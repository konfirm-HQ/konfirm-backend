import { Injectable, NotFoundException } from '@nestjs/common';
import { pool } from '../db/pool';

@Injectable()
export class AdminMerchantsService {
  async list(limit = 50, offset = 0) {
    const { rows } = await pool.query(
      `SELECT id, email, name, status, risk_tier, stellar_base_address, created_at
       FROM merchants
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows;
  }

  async setStatus(id: string, status: 'active' | 'suspended') {
    const { rows } = await pool.query(
      `UPDATE merchants SET status = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING id, email, name, status`,
      [id, status],
    );
    if (rows.length === 0) throw new NotFoundException('merchant not found');
    return rows[0];
  }
}
