CREATE TABLE IF NOT EXISTS reconciler_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed with 'now', never a hand-picked ledger value — a malformed cursor
-- makes the reconciler stream from nowhere while looking perfectly healthy.
INSERT INTO reconciler_state (key, value) VALUES ('cursor', 'now') ON CONFLICT DO NOTHING;
