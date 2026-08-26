-- Records the USD-equivalent conversion rate actually applied when a
-- non-USDC payment's amount_usdc/fee_usdc/net_usdc were computed (see the
-- reconciler's xlm_usdc_rate() fix). NULL for USDC payments (rate is
-- implicitly 1, not worth storing) and for any payment recorded before
-- this column existed -- there's no way to reconstruct a historical rate
-- after the fact (Horizon's order book has no point-in-time query), so
-- those rows honestly show "rate unknown" rather than a guessed value.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS fx_rate_to_usd NUMERIC;
