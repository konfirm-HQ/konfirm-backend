import { Injectable, NotFoundException } from '@nestjs/common';
import { pool } from '../db/pool';

export interface CreateLinkInput {
  merchant_id: string;
  amount_usdc?: string;
  currency?: string;
  description?: string;
  reusable?: boolean;
}

@Injectable()
export class LinksService {
  async create(input: CreateLinkInput) {
    const { rows } = await pool.query(
      `INSERT INTO links (merchant_id, amount_usdc, currency, description, reusable)
       VALUES ($1, $2, COALESCE($3, 'USDC'), $4, COALESCE($5, true))
       RETURNING id, merchant_id, amount_usdc, currency, description, reusable, active, created_at`,
      [
        input.merchant_id,
        input.amount_usdc ?? null,
        input.currency ?? null,
        input.description ?? null,
        input.reusable ?? null,
      ],
    );
    return rows[0];
  }

  // The narrow public projection a checkout page is allowed to see — no
  // merchant internals, matching the same principle the invoice public
  // projection enforced in the original design.
  async getPublic(id: string) {
    const { rows } = await pool.query(
      `SELECT l.id, l.amount_usdc, l.currency, l.description, l.active, l.expires_at,
              m.name AS merchant_name, m.stellar_base_address
       FROM links l JOIN merchants m ON m.id = l.merchant_id
       WHERE l.id = $1`,
      [id],
    );
    if (rows.length === 0) throw new NotFoundException('link not found');
    return rows[0];
  }
}
