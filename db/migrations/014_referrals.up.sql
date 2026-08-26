-- Every merchant gets a shareable code automatically at signup (no separate
-- "generate my code" step) so referring is zero-friction from day one.
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;

-- One row per successful attribution — a merchant can be referred at most
-- once (UNIQUE on referred_id), attributed to whoever's code they signed up
-- with. Deliberately no status/activated_at column: "activated" (has this
-- merchant processed a real payment yet) is computed at read time via a
-- join against payments, not stored and kept in sync by a write-time hook
-- — simpler, and can't drift out of sync with the reconciler.
CREATE TABLE IF NOT EXISTS referrals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_id UUID NOT NULL REFERENCES merchants(id),
    referred_id UUID UNIQUE NOT NULL REFERENCES merchants(id),
    code TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
