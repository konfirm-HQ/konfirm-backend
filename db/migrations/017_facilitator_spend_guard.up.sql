-- Every facilitator-signed submission gets logged here before it's allowed
-- to proceed, not just counted -- this doubles as a real audit trail (who
-- signed what, when) and as the spend-cap's own data source, so there's
-- no separate counter that could drift from what actually happened.
CREATE TABLE IF NOT EXISTS facilitator_spend_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    amount_usdc NUMERIC NOT NULL,
    operation TEXT NOT NULL,
    reference TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_facilitator_spend_log_created_at ON facilitator_spend_log (created_at);

-- Same key/value shape as reconciler_state, generalized under its own name
-- rather than overloading that table for an unrelated concept. A cap
-- breach sets 'halted_at' here; unlike the spend log itself, this does NOT
-- clear automatically at midnight -- the threat model this defends
-- against (the application doing something it shouldn't) calls for a
-- human to explicitly clear it, not a timer.
CREATE TABLE IF NOT EXISTS facilitator_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
