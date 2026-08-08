-- One generic audit log for every admin mutation, rather than a bespoke
-- audit table per feature — every admin write (suspend a merchant, hold a
-- payment, block an address, rewind the reconciler cursor) logs here with
-- the same shape, so "what did admins do and when" is always one query.
CREATE TABLE IF NOT EXISTS admin_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID NOT NULL REFERENCES admins(id),
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    detail JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
