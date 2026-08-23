-- Channel-backed x402 netting: an agent (payer) escrows funds against a
-- resource server (payee) and sends many off-chain signed claims, verified
-- locally with no RPC call, before the facilitator periodically settles
-- the net balance on-chain via the `channel` Soroban contract's
-- checkpoint(). Mutable, revisited state — not an append-only log like
-- x402_settlements — so this follows reconciler_state's in-place-UPDATE
-- idiom for the fields that change, plus a CHECK-constrained status
-- column mirroring the contract's own ChannelStatus enum.
CREATE TABLE IF NOT EXISTS x402_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    onchain_channel_id BIGINT UNIQUE NOT NULL,
    payer_address TEXT NOT NULL,
    payee_address TEXT NOT NULL,       -- resource server's payTo, classic G... — same
                                        -- pay_to/asset_contract distinction as x402_settlements
    asset_contract TEXT NOT NULL,
    payer_pubkey TEXT NOT NULL,
    -- NUMERIC, not TEXT — a deliberate deviation from x402_settlements'
    -- amount-as-TEXT convention. That table never compares amounts in SQL;
    -- this one has to (the keeper's core query is "pending_amount >
    -- claimed"), and TEXT would silently do a lexicographic string
    -- comparison instead of a numeric one. No i128-vs-BIGINT range concern
    -- here — that's specific to the on-chain signature payload, not this
    -- column type, and NUMERIC has no precision ceiling that would matter
    -- at real USDC amounts.
    deposited NUMERIC NOT NULL,
    claimed NUMERIC NOT NULL DEFAULT 0,        -- last amount actually checkpointed on-chain
    pending_amount NUMERIC NOT NULL DEFAULT 0, -- latest off-chain-verified claim, not yet
                                                -- checkpointed — the field that makes netting
                                                -- real: distinguishes "confirmed on-chain" from
                                                -- "accumulated, verified, awaiting settlement"
    pending_nonce BIGINT NOT NULL DEFAULT 0,
    pending_signature TEXT,            -- kept so the keeper can checkpoint it later, or defend
                                        -- it as a watchtower if a stale close starts
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closing', 'closed', 'held')),
    resource_url TEXT,
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closing_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The keeper's three sweep queries (checkpoint-due, idle-close-due,
-- finalize-due) all filter on status plus one timestamp comparison — these
-- partial indexes cover the hot "open"/"closing" sets cheaply without
-- indexing closed/held channels nobody sweeps repeatedly.
CREATE INDEX idx_x402_channels_open_activity ON x402_channels (last_activity_at) WHERE status = 'open';
CREATE INDEX idx_x402_channels_closing ON x402_channels (closing_at) WHERE status = 'closing';
