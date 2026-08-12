import { Injectable } from '@nestjs/common';
import { pool } from '../db/pool';

@Injectable()
export class AdminX402SettlementsService {
  async list(status?: string, limit = 50, offset = 0) {
    const params: unknown[] = [];
    let where = '';
    if (status) {
      params.push(status);
      where = `WHERE status = $${params.length}`;
    }
    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT id, payer_address, pay_to, asset_contract, amount, resource_url, status, tx_hash, created_at
       FROM x402_settlements
       ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return rows;
  }
}
