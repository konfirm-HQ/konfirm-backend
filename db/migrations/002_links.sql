CREATE TABLE IF NOT EXISTS links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id),
    amount_usdc NUMERIC(18,7),          -- NULL = pay-what-you-want
    currency TEXT NOT NULL DEFAULT 'USDC' CHECK (currency IN ('USDC','EURC','XLM')),
    description TEXT,
    reusable BOOLEAN NOT NULL DEFAULT TRUE,
    max_uses INT,
    expires_at TIMESTAMPTZ,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS links_merchant_active_idx ON links(merchant_id, active);

-- No status lifecycle here on purpose: a Link is either active or not. There
-- is nothing analogous to v1's invoice 'pending' state to manage or expire.
