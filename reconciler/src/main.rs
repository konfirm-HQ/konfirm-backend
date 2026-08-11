mod compliance;
mod horizon;
mod muxed;
mod store;

use anyhow::{bail, Context, Result};
use horizon::HorizonClient;
use std::time::Duration;
use store::Store;

const HORIZON_TESTNET: &str = "https://horizon-testnet.stellar.org";

fn database_url() -> String {
    std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres:///konfirm_dev".to_string())
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt().with_target(false).init();

    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("seed-merchant") => {
            let stellar_address = args
                .get(2)
                .expect("usage: seed-merchant <stellar_base_address> <email> <name>");
            let email = args.get(3).expect("email required");
            let name = args.get(4).cloned().unwrap_or_else(|| "Demo Merchant".to_string());
            let store = Store::connect(&database_url()).await?;
            let merchant = store
                .upsert_merchant_by_stellar_address(stellar_address, email, &name)
                .await?;
            tracing::info!(merchant_id = %merchant.id, stellar_address, fee_bps = merchant.fee_bps, "merchant seeded in Postgres");
            Ok(())
        }
        Some("watch") => {
            let merchant = args.get(2).expect("usage: watch <merchant_base> [max_polls] [interval_secs]");
            let max_polls: u32 = args.get(3).map(|s| s.parse()).transpose()?.unwrap_or(20);
            let interval_secs: u64 = args.get(4).map(|s| s.parse()).transpose()?.unwrap_or(3);
            watch(merchant, max_polls, interval_secs).await
        }
        Some("set-cursor") => {
            // Operational escape hatch, not a routine path — see
            // docs/RECOVERY.md's "reconciler cursor reset" runbook entry.
            // Real production restarts always resume from the last
            // persisted cursor; this exists for deliberate replays and
            // disaster recovery, not everyday use.
            let value = args.get(2).expect("usage: set-cursor <value|'now'>");
            let store = Store::connect(&database_url()).await?;
            store.set_cursor(value).await?;
            tracing::info!(cursor = %value, "cursor manually reset");
            Ok(())
        }
        _ => {
            bail!("usage: reconciler <seed-merchant|watch|set-cursor> ...");
        }
    }
}

async fn watch(merchant_address: &str, max_polls: u32, interval_secs: u64) -> Result<()> {
    let store = Store::connect(&database_url()).await?;
    let horizon = HorizonClient::new(HORIZON_TESTNET);

    let merchant = store
        .find_merchant_by_stellar_address(merchant_address)
        .await?
        .context("no merchant row for this stellar address — run seed-merchant first")?;
    tracing::info!(merchant_id = %merchant.id, fee_bps = merchant.fee_bps, "resolved merchant");

    let mut cursor = store.get_cursor().await?;
    if cursor == "now" {
        cursor = horizon.resolve_now_cursor(merchant_address).await?;
        tracing::info!(cursor, "resolved 'now' cursor to current head — never starting from a hardcoded value");
        store.set_cursor(&cursor).await?;
    }

    // Background on-chain compliance checks spawned below — collected here
    // so a clean exit from this function (either return point) waits for
    // them rather than dropping a pending check silently. An abrupt kill of
    // the whole process can still drop one; that's an accepted gap, matching
    // the existing fail-open philosophy rather than a new category of risk.
    let mut pending_checks: Vec<tokio::task::JoinHandle<()>> = Vec::new();

    let mut found_any = false;
    for poll_num in 1..=max_polls {
        tracing::info!(poll_num, cursor, "polling horizon");
        let ops = horizon.payments_since(merchant_address, &cursor, 50).await?;

        for op in &ops {
            if op.op_type != "payment" {
                cursor = op.paging_token.clone();
                continue;
            }

            // Primary path: the session id travels as a MEMO_ID now (see
            // horizon.rs) — this is what Freighter-signed checkout payments
            // carry. Fallback: decode a muxed destination address, which is
            // how the non-wallet harness script (pay.js) still pays, since
            // that path never went through Freighter's buggy confirm UI.
            let memo_id = op.transaction.as_ref().and_then(|t| {
                if t.memo_type.as_deref() == Some("id") {
                    t.memo.as_deref()?.parse::<u64>().ok()
                } else {
                    None
                }
            });
            let muxed_id = memo_id.or_else(|| {
                muxed::payment_muxed_id(
                    op.to_muxed_id.as_deref(),
                    op.to_muxed.as_deref(),
                    op.to.as_deref().unwrap_or(""),
                )
            });

            let Some(muxed_id) = muxed_id else {
                tracing::warn!(paging_token = %op.paging_token, "payment carries no session memo or muxed destination — recording unmatched");
                cursor = op.paging_token.clone();
                continue;
            };

            let (asset_code, asset_issuer): (String, Option<String>) = match op.asset_type.as_deref() {
                Some("native") => ("XLM".to_string(), None),
                _ => (
                    op.asset_code.clone().unwrap_or_default(),
                    op.asset_issuer.clone(),
                ),
            };
            let payer = op.from.clone().unwrap_or_default();
            let amount = op.amount.as_deref().unwrap_or("0");
            let muxed_address = op.to_muxed.clone().unwrap_or_else(|| op.to.clone().unwrap_or_default());

            let recorded = store
                .record_payment_if_new(
                    &merchant,
                    muxed_id as i64,
                    &muxed_address,
                    &payer,
                    &asset_code,
                    asset_issuer.as_deref(),
                    amount,
                    &op.paging_token,
                    &op.transaction_hash,
                )
                .await?;

            if let Some(recorded) = recorded {
                tracing::info!(
                    muxed_id,
                    merchant_id = %merchant.id,
                    payer = %payer,
                    amount = %amount,
                    asset = %asset_code,
                    tx_hash = %op.transaction_hash,
                    locally_blocked = recorded.locally_blocked,
                    "MATCHED: payment recorded in Postgres with real fee math"
                );
                found_any = true;

                // Already flagged and held via the cheap local check above —
                // no need for the slower on-chain check too.
                if !recorded.locally_blocked {
                    let store = store.clone();
                    let payer = payer.clone();
                    let payment_id = recorded.id;
                    pending_checks.push(tokio::spawn(async move {
                        if !compliance::is_allowed_on_chain(&payer).await {
                            match store.mark_held(payment_id).await {
                                Ok(()) => tracing::warn!(
                                    payment_id = %payment_id,
                                    payer = %payer,
                                    "payment flagged by on-chain compliance check after the fact — marked held for review"
                                ),
                                Err(err) => tracing::warn!(
                                    payment_id = %payment_id,
                                    error = %err,
                                    "failed to mark a compliance-flagged payment held"
                                ),
                            }
                        }
                    }));
                }
            } else {
                tracing::debug!(paging_token = %op.paging_token, "already seen — dedup no-op, as expected on replay");
            }

            // Advance only after the record is durably committed above —
            // never before. A crash between insert and this line just
            // reprocesses the same op next run, which record_payment_if_new
            // makes a safe no-op.
            cursor = op.paging_token.clone();
            store.set_cursor(&cursor).await?;
        }

        tokio::time::sleep(Duration::from_secs(interval_secs)).await;
    }

    if !found_any {
        tracing::warn!("no matching payment observed within the polling budget");
    }
    await_pending_checks(pending_checks).await;
    Ok(())
}

// A clean exit from watch() waits for any in-flight background compliance
// checks rather than dropping them — see the comment where pending_checks
// is declared. A failed/panicked task is logged, not propagated: losing one
// compliance re-check must never crash the reconciler.
async fn await_pending_checks(pending_checks: Vec<tokio::task::JoinHandle<()>>) {
    for handle in pending_checks {
        if let Err(err) = handle.await {
            tracing::warn!(error = %err, "a background compliance check task panicked");
        }
    }
}
