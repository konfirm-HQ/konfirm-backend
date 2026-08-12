-- Agent-to-facilitator settlement, deliberately separate from `payments` —
-- there's no merchant/link concept here, just a payer, a recipient, and an
-- asset, settled via the x402 `exact` Stellar scheme (Soroban auth entries,
-- not classic Horizon payments).
CREATE TABLE IF NOT EXISTS x402_settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payer_address TEXT NOT NULL,
    -- Classic G... account, NOT the SAC contract address — the SAC transfer
    -- settles into this account's classic USDC balance, so it needs its own
    -- trustline already. Kept as a separate field from asset_contract below
    -- because the two are easy to mix up (a documented pitfall).
    pay_to TEXT NOT NULL,
    -- The SAC contract address (C...) actually invoked.
    asset_contract TEXT NOT NULL,
    amount TEXT NOT NULL,
    resource_url TEXT,
    status TEXT NOT NULL DEFAULT 'settled' CHECK (status IN ('settled', 'failed', 'held')),
    tx_hash TEXT,
    idempotency_key TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
