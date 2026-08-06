import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { pool } from '../db/pool';

// A dev fallback keeps `npm start` working out of the box, but it's loud
// about it rather than silently signing real sessions with a guessable key
// — the same fail-open-but-never-silent pattern the compliance check uses.
const JWT_SECRET = process.env.JWT_SECRET ?? (() => {
  // eslint-disable-next-line no-console
  console.warn('[auth] JWT_SECRET not set — using an insecure dev-only default. Set JWT_SECRET before this ever leaves localhost.');
  return 'dev-only-insecure-secret-change-me';
})();
const TOKEN_TTL = '30d';

export interface MerchantClaims {
  id: string;
  email: string;
  name: string;
  stellar_base_address: string | null;
}

@Injectable()
export class AuthService {
  async signup(email: string, password: string, name: string, stellarBaseAddress: string): Promise<{ token: string; merchant: MerchantClaims }> {
    const existing = await pool.query('SELECT id FROM merchants WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      throw new ConflictException('an account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO merchants (email, password_hash, name, stellar_base_address, status)
       VALUES ($1, $2, $3, $4, 'active')
       RETURNING id, email, name, stellar_base_address`,
      [email, passwordHash, name, stellarBaseAddress],
    );
    const merchant = rows[0] as MerchantClaims;
    return { token: this.issueToken(merchant), merchant };
  }

  async login(email: string, password: string): Promise<{ token: string; merchant: MerchantClaims }> {
    const { rows } = await pool.query(
      'SELECT id, email, name, stellar_base_address, password_hash FROM merchants WHERE email = $1',
      [email],
    );
    // Same generic error whether the email doesn't exist or the password is
    // wrong — telling them apart lets an attacker enumerate real accounts.
    const invalid = () => new UnauthorizedException('invalid email or password');
    if (rows.length === 0) throw invalid();

    const row = rows[0];
    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) throw invalid();

    const merchant: MerchantClaims = {
      id: row.id,
      email: row.email,
      name: row.name,
      stellar_base_address: row.stellar_base_address,
    };
    return { token: this.issueToken(merchant), merchant };
  }

  verifyToken(token: string): MerchantClaims {
    try {
      return jwt.verify(token, JWT_SECRET) as unknown as MerchantClaims;
    } catch {
      throw new UnauthorizedException('session expired or invalid — please log in again');
    }
  }

  private issueToken(merchant: MerchantClaims): string {
    return jwt.sign(
      { id: merchant.id, email: merchant.email, name: merchant.name, stellar_base_address: merchant.stellar_base_address },
      JWT_SECRET,
      { expiresIn: TOKEN_TTL },
    );
  }
}
