ALTER TABLE referrals DROP COLUMN IF EXISTS reward_granted_at;
ALTER TABLE merchants DROP COLUMN IF EXISTS promo_volume_cap_usdc;
ALTER TABLE merchants DROP COLUMN IF EXISTS promo_expires_at;
ALTER TABLE merchants DROP COLUMN IF EXISTS promo_fee_bps;
