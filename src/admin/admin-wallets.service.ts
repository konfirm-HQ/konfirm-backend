import { Injectable } from '@nestjs/common';
import { pool } from '../db/pool';

// No dedicated wallets table — this cross-references every address role
// already tracked separately (a payer in payments, a merchant's own
// stellar_base_address, a blocked_addresses entry) into one directory, so
// e.g. an address that's both a payer AND blocked shows both roles in one
// place instead of requiring three separate lookups to notice.
@Injectable()
export class AdminWalletsService {
  async list(limit = 50, offset = 0) {
    const { rows } = await pool.query(
      `WITH addr_roles AS (
         SELECT payer_address AS address, 'payer' AS role FROM payments
         UNION
         SELECT stellar_base_address AS address, 'merchant' AS role
         FROM merchants WHERE stellar_base_address IS NOT NULL
         UNION
         SELECT stellar_address AS address, 'blocked' AS role FROM blocked_addresses
       )
       SELECT address, array_agg(DISTINCT role ORDER BY role) AS roles
       FROM addr_roles
       GROUP BY address
       ORDER BY address
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows;
  }
}
