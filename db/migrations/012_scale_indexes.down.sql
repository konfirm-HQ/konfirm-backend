CREATE INDEX IF NOT EXISTS link_sessions_lookup_idx ON link_sessions (merchant_id, muxed_id);

DROP INDEX IF EXISTS links_created_at_idx;
DROP INDEX IF EXISTS withdrawal_attempts_created_at_idx;
DROP INDEX IF EXISTS admin_actions_created_at_idx;
DROP INDEX IF EXISTS x402_settlements_status_created_at_idx;
DROP INDEX IF EXISTS x402_settlements_created_at_idx;
DROP INDEX IF EXISTS payments_status_created_at_idx;
DROP INDEX IF EXISTS payments_created_at_idx;
