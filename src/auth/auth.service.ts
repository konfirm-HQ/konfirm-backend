import { ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
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

// Excludes 0/O/1/I — ambiguous when read aloud or typed from memory, which
// is exactly how a referral code gets shared in practice.
const REFERRAL_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const REFERRAL_CODE_LENGTH = 8;

function randomReferralCode(): string {
  let code = '';
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
    code += REFERRAL_CODE_ALPHABET[Math.floor(Math.random() * REFERRAL_CODE_ALPHABET.length)];
  }
  return code;
}

@Injectable()
export class AuthService {
  async signup(
    email: string,
    password: string,
    name: string,
    stellarBaseAddress: string,
    referralCode?: string,
  ): Promise<{ token: string; merchant: MerchantClaims }> {
    const existing = await pool.query('SELECT id FROM merchants WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      throw new ConflictException('an account with this email already exists');
    }

    // An invalid/mistyped referral code should never block signup — it's a
    // growth mechanism, not a security gate. Looked up before the INSERT so
    // a bad code costs nothing (no wasted account row) if it doesn't exist.
    let referrerId: string | null = null;
    if (referralCode) {
      const referrer = await pool.query('SELECT id FROM merchants WHERE referral_code = $1', [referralCode.toUpperCase()]);
      referrerId = referrer.rows[0]?.id ?? null;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const ownCode = await this.generateUniqueReferralCode();
    const { rows } = await pool.query(
      `INSERT INTO merchants (email, password_hash, name, stellar_base_address, status, referral_code)
       VALUES ($1, $2, $3, $4, 'active', $5)
       RETURNING id, email, name, stellar_base_address`,
      [email, passwordHash, name, stellarBaseAddress, ownCode],
    );
    const merchant = rows[0] as MerchantClaims;

    if (referrerId) {
      await pool.query('INSERT INTO referrals (referrer_id, referred_id, code) VALUES ($1, $2, $3)', [
        referrerId,
        merchant.id,
        referralCode!.toUpperCase(),
      ]);
    }

    return { token: this.issueToken(merchant), merchant };
  }

  // Astronomically unlikely to collide at this alphabet/length (32^8), but
  // a signup is exactly the wrong place to let an unhandled unique-
  // constraint violation surface as a raw 500, so this checks first rather
  // than trusting probability alone.
  private async generateUniqueReferralCode(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomReferralCode();
      const { rows } = await pool.query('SELECT 1 FROM merchants WHERE referral_code = $1', [code]);
      if (rows.length === 0) return code;
    }
    throw new Error('could not generate a unique referral code after 5 attempts');
  }

  async login(email: string, password: string): Promise<{ token: string; merchant: MerchantClaims }> {
    const { rows } = await pool.query(
      'SELECT id, email, name, stellar_base_address, password_hash, status FROM merchants WHERE email = $1',
      [email],
    );
    // Same generic error whether the email doesn't exist or the password is
    // wrong — telling them apart lets an attacker enumerate real accounts.
    const invalid = () => new UnauthorizedException('invalid email or password');
    if (rows.length === 0) throw invalid();

    const row = rows[0];
    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) throw invalid();

    // A distinct message is fine here, unlike above — a correct password
    // already confirms the account exists, so this isn't an enumeration risk.
    if (row.status === 'suspended') {
      throw new ForbiddenException('this account has been suspended — contact support');
    }

    const merchant: MerchantClaims = {
      id: row.id,
      email: row.email,
      name: row.name,
      stellar_base_address: row.stellar_base_address,
    };
    return { token: this.issueToken(merchant), merchant };
  }

  // "Activated" is computed here (EXISTS a paid payment), not stored — see
  // migration 014's comment for why that's deliberate.
  async myReferrals(merchantId: string): Promise<{ code: string | null; referrals: unknown[] }> {
    const { rows: codeRows } = await pool.query('SELECT referral_code FROM merchants WHERE id = $1', [merchantId]);
    const { rows: referrals } = await pool.query(
      `SELECT m.name, m.email, r.created_at,
              EXISTS(SELECT 1 FROM payments p WHERE p.merchant_id = r.referred_id AND p.status = 'paid') AS activated
       FROM referrals r
       JOIN merchants m ON m.id = r.referred_id
       WHERE r.referrer_id = $1
       ORDER BY r.created_at DESC`,
      [merchantId],
    );
    return { code: codeRows[0]?.referral_code ?? null, referrals };
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
