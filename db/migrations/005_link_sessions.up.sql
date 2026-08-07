-- The piece §1 of the redesign actually depends on: the mandatory
-- compliance/prepare-tx call is where a client-derived muxed_id gets
-- reserved against a Link — not a new API call, the same one that was
-- already unavoidable. This table is that reservation, nothing more: no
-- 'pending' payment state, just a record of which Link a muxed_id belongs
-- to, written before the payment, read by the reconciler after it.
CREATE TABLE IF NOT EXISTS link_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    link_id UUID NOT NULL REFERENCES links(id),
    merchant_id UUID NOT NULL REFERENCES merchants(id),
    muxed_id BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (merchant_id, muxed_id)
);

CREATE INDEX IF NOT EXISTS link_sessions_lookup_idx ON link_sessions(merchant_id, muxed_id);
