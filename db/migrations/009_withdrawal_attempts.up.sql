-- Withdrawals/cash-outs have no local state otherwise — the whole SEP-24
-- flow is a live proxy to the anchor (testanchor.stellar.org), which is the
-- only place a transaction's real status lives. This table exists purely so
-- an admin has something to look at: what a merchant started, and the last
-- status Konfirm observed the anchor report for it. `token` holds the
-- anchor's short-lived SEP-10 session JWT so that status can be re-polled
-- later; once it expires, refreshing simply stops updating the row (see
-- README's Known limitations).
CREATE TABLE IF NOT EXISTS withdrawal_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id),
    currency TEXT NOT NULL,
    anchor_tx_id TEXT NOT NULL,
    token TEXT NOT NULL,
    last_status TEXT,
    last_polled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
