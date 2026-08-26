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

  // risk_tier already existed on this table and was already displayed
  // read-only on the merchants page — this is the missing write path, not
  // new schema. Genuine identity/KYC verification (documents, a provider
  // integration) is a separate, much bigger, and still entirely unbuilt
  // capability; this only lets an admin manually set which tier a merchant
  // is treated as, the same way status changes are manual today.
  async setTier(id: string, riskTier: 'unverified' | 'standard' | 'established' | 'enterprise') {
    const { rows } = await pool.query(
      `UPDATE merchants SET risk_tier = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING id, email, name, risk_tier`,
      [id, riskTier],
    );
    if (rows.length === 0) throw new NotFoundException('merchant not found');
    return rows[0];
  }
}
