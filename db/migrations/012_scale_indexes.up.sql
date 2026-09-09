-- Scale-readiness indexes for the admin list queries that ORDER BY
-- created_at DESC across every row (not scoped to one merchant/link) — the
-- query shape that degrades first as these tables grow into the millions
-- of rows. Additive only; no existing query needs to change.
--
-- payments and x402_settlements each have two real query shapes in their
-- admin list services (AdminPaymentsService.list, AdminX402SettlementsService.list):
-- an unfiltered "ORDER BY created_at DESC" default view, and a
-- "WHERE status = $1 ORDER BY created_at DESC" filtered view. A composite
-- (status, created_at DESC) index alone can't serve the unfiltered case
-- efficiently (Postgres would have to scan the index across every status
-- value to get global created_at order), so both tables get a plain
-- created_at index for the default view plus the composite for the
-- filtered one. admin_actions/withdrawal_attempts/links only ever query
-- unfiltered, so a plain index is enough for those.
CREATE INDEX IF NOT EXISTS payments_created_at_idx ON payments (created_at DESC);
CREATE INDEX IF NOT EXISTS payments_status_created_at_idx ON payments (status, created_at DESC);
CREATE INDEX IF NOT EXISTS x402_settlements_created_at_idx ON x402_settlements (created_at DESC);
CREATE INDEX IF NOT EXISTS x402_settlements_status_created_at_idx ON x402_settlements (status, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_actions_created_at_idx ON admin_actions (created_at DESC);
CREATE INDEX IF NOT EXISTS withdrawal_attempts_created_at_idx ON withdrawal_attempts (created_at DESC);
CREATE INDEX IF NOT EXISTS links_created_at_idx ON links (created_at DESC);

-- Byte-for-byte redundant with the implicit unique index Postgres already
-- created for link_sessions' UNIQUE (merchant_id, muxed_id) constraint —
-- pure write-overhead on every insert with no read benefit over the
-- constraint's own index.
DROP INDEX IF EXISTS link_sessions_lookup_idx;
