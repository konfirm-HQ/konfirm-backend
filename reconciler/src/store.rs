use anyhow::{Context, Result};
use rust_decimal::Decimal;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::str::FromStr;
use uuid::Uuid;

// Real Postgres, against the real migrations in db/migrations/. This
// replaces the SQLite placeholder used earlier in the build — same
// UNIQUE(paging_token) dedup guarantee, same "advance the cursor only after
// the commit" discipline, now against the actual schema.

#[derive(Clone)]
pub struct Store {
    pool: PgPool,
}

#[derive(Debug, Clone)]
pub struct Merchant {
    pub id: Uuid,
    pub fee_bps: i32,
}

#[derive(Debug, Clone)]
pub struct RecordedPayment {
    pub id: Uuid,
    pub locally_blocked: bool,
}

/// Pure decision logic for the referral-trial discount, deliberately
/// separated from the SQL that fetches its inputs (see
/// `Store::effective_fee_bps`) so it's unit-testable without a database or
/// any date/time handling in Rust — `promo_time_valid` is a plain bool
/// already resolved by Postgres's own `NOW()`, not a timestamp this
/// function has to parse or compare itself.
fn resolve_effective_fee_bps(
    base_fee_bps: i32,
    promo_fee_bps: Option<i32>,
    promo_time_valid: bool,
    promo_volume_cap_usdc: Option<Decimal>,
    volume_so_far_usdc: Decimal,
) -> i32 {
    match promo_fee_bps {
        Some(promo) if promo_time_valid && promo_volume_cap_usdc.map_or(true, |cap| volume_so_far_usdc < cap) => promo,
        _ => base_fee_bps,
    }
}

impl Store {
    pub async fn connect(database_url: &str) -> Result<Self> {
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(database_url)
            .await
            .context("failed to connect to Postgres")?;
        Ok(Self { pool })
    }

    pub async fn upsert_merchant_by_stellar_address(
        &self,
        stellar_base_address: &str,
        email: &str,
        name: &str,
    ) -> Result<Merchant> {
        let row = sqlx::query_as::<_, (Uuid, i32)>(
            "INSERT INTO merchants (email, password_hash, name, stellar_base_address)
             VALUES ($1, 'demo-harness-no-login', $2, $3)
             ON CONFLICT (email) DO UPDATE SET stellar_base_address = excluded.stellar_base_address
             RETURNING id, fee_bps",
        )
        .bind(email)
        .bind(name)
        .bind(stellar_base_address)
        .fetch_one(&self.pool)
        .await?;
        Ok(Merchant { id: row.0, fee_bps: row.1 })
    }

    pub async fn find_merchant_by_stellar_address(&self, address: &str) -> Result<Option<Merchant>> {
        let row = sqlx::query_as::<_, (Uuid, i32)>(
            "SELECT id, fee_bps FROM merchants WHERE stellar_base_address = $1",
        )
        .bind(address)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|(id, fee_bps)| Merchant { id, fee_bps }))
    }

    // The SEP-7/QR checkout path has no payer address to screen before the
    // fact — this is the local half of the after-the-fact check that closes
    // that gap, mirroring payments.service.ts's isPayerAllowed query exactly.
    pub async fn is_locally_blocked(&self, address: &str) -> Result<bool> {
        let row: Option<(i32,)> = sqlx::query_as("SELECT 1 FROM blocked_addresses WHERE stellar_address = $1")
            .bind(address)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.is_some())
    }

    /// Called by the background on-chain compliance check, never inline in
    /// the poll loop — see record_payment_if_new's doc comment for why.
    pub async fn mark_held(&self, payment_id: Uuid) -> Result<()> {
        sqlx::query("UPDATE payments SET status = 'held' WHERE id = $1")
            .bind(payment_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Inserts a materialized Payment row against the real schema. Returns
    /// Ok(None) if paging_token was already seen — the UNIQUE constraint on
    /// paging_token *is* the idempotency guarantee, not application-level
    /// dedup logic — or Ok(Some(RecordedPayment)) if this was genuinely new.
    ///
    /// The local blocklist is checked here, synchronously, before the
    /// insert — it's a cheap in-process DB read with no meaningful latency
    /// cost, so a locally-blocked address lands as 'held' immediately. The
    /// slower on-chain compliance contract is deliberately NOT checked here:
    /// this function is called once per payment inside the reconciler's
    /// strictly sequential poll loop, and blocking that loop on an ~9s
    /// worst-case external process call risks the reconciler itself falling
    /// behind — a worse, already-documented incident (docs/RUNBOOK.md §4)
    /// than a flagged payment sitting as 'paid' for a few extra seconds. The
    /// caller (main.rs) is expected to run that check afterward, out of
    /// band, using the returned id to flip the row via mark_held if needed.
    ///
    /// link_id resolves via link_sessions — the reservation the API's
    /// session-reserve endpoint writes before the payment happens (§1: the
    /// one unavoidable server round trip, compliance screening, now also
    /// doing double duty as the nonce registration). If nothing reserved
    /// this muxed_id — a terminal tap, an agent payment, or a payer who
    /// bypassed the API and sent XLM straight to the address — link_id is
    /// correctly NULL rather than a guess.
    /// Recomputed fresh on every payment, not cached alongside `Merchant`
    /// (which is fetched once per `watch` run and reused across the whole
    /// session) — a promo can expire, or its volume cap can be crossed,
    /// partway through a long-running session, and the next payment must
    /// see that. All date/time comparison happens here in SQL (`NOW()`),
    /// not in Rust, specifically so the decision logic in
    /// `resolve_effective_fee_bps` stays a pure, unit-testable function
    /// with no chrono dependency at all.
    async fn effective_fee_bps(&self, merchant: &Merchant) -> Result<i32> {
        let row: (Option<i32>, bool, Option<Decimal>, Decimal) = sqlx::query_as(
            "SELECT
                promo_fee_bps,
                (promo_expires_at IS NOT NULL AND promo_expires_at > NOW()) AS promo_time_valid,
                promo_volume_cap_usdc,
                COALESCE((SELECT SUM(amount_usdc) FROM payments WHERE merchant_id = $1 AND status = 'paid'), 0)
             FROM merchants WHERE id = $1",
        )
        .bind(merchant.id)
        .fetch_one(&self.pool)
        .await?;
        let (promo_fee_bps, promo_time_valid, promo_volume_cap_usdc, volume_so_far_usdc) = row;
        Ok(resolve_effective_fee_bps(
            merchant.fee_bps,
            promo_fee_bps,
            promo_time_valid,
            promo_volume_cap_usdc,
            volume_so_far_usdc,
        ))
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn record_payment_if_new(
        &self,
        merchant: &Merchant,
        muxed_id: i64,
        muxed_address: &str,
        payer_address: &str,
        asset_code: &str,
        asset_issuer: Option<&str>,
        amount: &str,
        fx_rate_to_usd: Option<Decimal>,
        paging_token: &str,
        tx_hash: &str,
    ) -> Result<Option<RecordedPayment>> {
        let gross = Decimal::from_str(amount).context("horizon returned a non-decimal amount")?;
        let fee_bps = self.effective_fee_bps(merchant).await?;
        let fee = (gross * Decimal::from(fee_bps)) / Decimal::from(10_000);
        let net = gross - fee;

        // Horizon paging tokens for operations are TOIDs: ledger sequence in
        // the high 32 bits, tx order and op order in the low 32. Decoding it
        // is the correct way to get ledger_sequence without a second round
        // trip to fetch the transaction.
        let ledger_sequence: i64 = paging_token
            .parse::<u64>()
            .map(|toid| (toid >> 32) as i64)
            .unwrap_or(0);

        let link_id: Option<Uuid> = sqlx::query_as::<_, (Uuid,)>(
            "SELECT link_id FROM link_sessions WHERE merchant_id = $1 AND muxed_id = $2",
        )
        .bind(merchant.id)
        .bind(muxed_id)
        .fetch_optional(&self.pool)
        .await?
        .map(|(id,)| id);

        let locally_blocked = self.is_locally_blocked(payer_address).await?;
        let status = if locally_blocked { "held" } else { "paid" };

        let inserted: Option<(Uuid,)> = sqlx::query_as(
            "INSERT INTO payments
                (merchant_id, link_id, muxed_id, muxed_address, payer_address,
                 asset_code, asset_issuer, amount_usdc, fee_usdc, net_usdc, fx_rate_to_usd,
                 channel, status, paging_token, tx_hash, ledger_sequence)
             VALUES
                ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                 'hosted_checkout', $12, $13, $14, $15)
             ON CONFLICT (paging_token) DO NOTHING
             RETURNING id",
        )
        .bind(merchant.id)
        .bind(link_id)
        .bind(muxed_id)
        .bind(muxed_address)
        .bind(payer_address)
        .bind(asset_code)
        .bind(asset_issuer)
        .bind(gross)
        .bind(fee)
        .bind(net)
        .bind(fx_rate_to_usd)
        .bind(status)
        .bind(paging_token)
        .bind(tx_hash)
        .bind(ledger_sequence)
        .fetch_optional(&self.pool)
        .await?;

        Ok(inserted.map(|(id,)| RecordedPayment { id, locally_blocked }))
    }

    pub async fn get_cursor(&self) -> Result<String> {
        let row: Option<(String,)> =
            sqlx::query_as("SELECT value FROM reconciler_state WHERE key = 'cursor'")
                .fetch_optional(&self.pool)
                .await?;
        Ok(row.map(|(v,)| v).unwrap_or_else(|| "now".to_string()))
    }

    /// Only ever called after a payment has been durably committed above —
    /// advancing the cursor before the commit is how a crash mid-stream
    /// turns into a silently skipped payment.
    pub async fn set_cursor(&self, cursor: &str) -> Result<()> {
        sqlx::query(
            "INSERT INTO reconciler_state (key, value, updated_at) VALUES ('cursor', $1, NOW())
             ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = NOW()",
        )
        .bind(cursor)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn no_promo_uses_the_base_rate() {
        assert_eq!(resolve_effective_fee_bps(10, None, false, None, Decimal::from(0)), 10);
    }

    #[test]
    fn active_promo_within_time_and_volume_uses_the_promo_rate() {
        assert_eq!(
            resolve_effective_fee_bps(10, Some(0), true, Some(Decimal::from(500)), Decimal::from(100)),
            0
        );
    }

    #[test]
    fn expired_promo_falls_back_to_the_base_rate_even_with_volume_left() {
        assert_eq!(
            resolve_effective_fee_bps(10, Some(0), false, Some(Decimal::from(500)), Decimal::from(100)),
            10
        );
    }

    #[test]
    fn promo_exactly_at_the_volume_cap_no_longer_applies() {
        // Strictly less-than, not less-than-or-equal — the 500th dollar
        // itself is charged at the base rate, matching "first $500 free"
        // read the ordinary way (500 dollars have already been covered).
        assert_eq!(
            resolve_effective_fee_bps(10, Some(0), true, Some(Decimal::from(500)), Decimal::from(500)),
            10
        );
    }

    #[test]
    fn promo_just_under_the_volume_cap_still_applies() {
        assert_eq!(
            resolve_effective_fee_bps(10, Some(0), true, Some(Decimal::new(4999, 1)), Decimal::from(499)),
            0
        );
    }

    #[test]
    fn referrer_reward_has_no_volume_cap_and_applies_purely_on_time() {
        // The referrer's reward is time-only (promo_volume_cap_usdc = NULL)
        // — a large existing volume must never disqualify it.
        assert_eq!(
            resolve_effective_fee_bps(10, Some(5), true, None, Decimal::from(1_000_000)),
            5
        );
    }

    #[test]
    fn no_promo_fee_bps_set_uses_base_rate_regardless_of_other_fields() {
        // A merchant who was never referred has promo_fee_bps = NULL —
        // stray non-NULL time/volume fields (shouldn't happen, but this is
        // the function's actual contract) must not accidentally activate
        // a discount that was never granted.
        assert_eq!(resolve_effective_fee_bps(10, None, true, Some(Decimal::from(500)), Decimal::from(0)), 10);
    }
}
