CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id),
    link_id UUID REFERENCES links(id),      -- NULL for terminal/agent standing-address payments
    muxed_id BIGINT NOT NULL,
    muxed_address TEXT NOT NULL,
    payer_address TEXT NOT NULL,
    asset_code TEXT NOT NULL,
    asset_issuer TEXT,                      -- NULL for native XLM
    amount_usdc NUMERIC(18,7) NOT NULL,
    fee_usdc NUMERIC(18,7) NOT NULL DEFAULT 0,
    net_usdc NUMERIC(18,7) NOT NULL,
    channel TEXT NOT NULL DEFAULT 'hosted_checkout'
        CHECK (channel IN ('hosted_checkout','terminal','agent_api')),
    status TEXT NOT NULL DEFAULT 'paid'
        CHECK (status IN ('paid','held','refunded','disputed')),
    paging_token TEXT UNIQUE NOT NULL,      -- Horizon cursor: the dedup key. This
                                             -- constraint IS the idempotency
                                             -- guarantee — a replayed Horizon
                                             -- event is a no-op insert conflict,
                                             -- not application logic.
    tx_hash TEXT NOT NULL,
    ledger_sequence BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Written once, by the reconciler, after Horizon has already confirmed the
-- transfer. There is no INSERT path for a 'pending' row — see the redesign
-- memo, §1: nothing is written until money has actually moved.
CREATE INDEX IF NOT EXISTS payments_merchant_idx ON payments(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_link_idx ON payments(link_id);
CREATE UNIQUE INDEX IF NOT EXISTS payments_muxed_id_idx ON payments(merchant_id, muxed_id);
