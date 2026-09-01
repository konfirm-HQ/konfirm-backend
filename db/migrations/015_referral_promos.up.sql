-- The referred merchant's trial discount and the referrer's earned reward
-- both use the same three-column shape: a discounted rate, a time bound,
-- and an optional volume bound (NULL = no volume cap, used for the
-- referrer's reward since it's time-only). Deliberately not a "reverts to
-- normal" write later -- effective_fee_bps() (reconciler/src/store.rs)
-- computes whether the promo is still active fresh on every payment, so
-- there's nothing to expire or clean up for correctness, only for tidiness.
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS promo_fee_bps INT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS promo_expires_at TIMESTAMPTZ;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS promo_volume_cap_usdc NUMERIC;

-- Idempotency guard for the referrer-reward sweep (see
-- src/referrals/referral-rewards.service.ts) -- NULL means not yet
-- granted; set exactly once, the moment the referred merchant's first paid
-- payment is observed.
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS reward_granted_at TIMESTAMPTZ;
