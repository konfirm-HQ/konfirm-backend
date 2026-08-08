import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { pool } from '../db/pool';

@Injectable()
export class AdminComplianceService {
  async list() {
    const { rows } = await pool.query(
      `SELECT ba.id, ba.stellar_address, ba.reason, ba.created_at, a.name AS blocked_by_name
       FROM blocked_addresses ba
       LEFT JOIN admins a ON a.id = ba.blocked_by
       ORDER BY ba.created_at DESC`,
    );
    return rows;
  }

  async block(stellarAddress: string, adminId: string, reason?: string) {
    try {
      const { rows } = await pool.query(
        `INSERT INTO blocked_addresses (stellar_address, reason, blocked_by) VALUES ($1, $2, $3)
         RETURNING id, stellar_address, reason, created_at`,
        [stellarAddress, reason ?? null, adminId],
      );
      return rows[0];
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw new ConflictException('this address is already blocked');
      throw err;
    }
  }

  async unblock(id: string) {
    const { rows } = await pool.query('DELETE FROM blocked_addresses WHERE id = $1 RETURNING id', [id]);
    if (rows.length === 0) throw new NotFoundException('blocked address not found');
  }
}
