use anyhow::{Context, Result};
use serde::Deserialize;

// The /payments endpoint is misleadingly named — it actually returns every
// operation type that can move an asset (payment, create_account,
// path_payment_*, etc.), and each type carries a different field set.
// create_account in particular has no asset_type/from/to at all. Everything
// past the four fields every operation shares must be optional, or a single
// non-payment record in the page throws out the whole batch.
// Requested via `join=transactions` so each operation record embeds its
// enclosing transaction — that's where the MEMO_ID carrying the link
// session id lives now. Session routing moved off muxed (M...) destination
// addresses because Freighter's wallet extension has open bugs decoding
// muxed accounts in its own sign-confirmation UI (stellar/freighter#2841,
// #2856, #2863); a plain destination + memo is universally supported.
#[derive(Debug, Deserialize, Clone)]
pub struct EmbeddedTransaction {
    pub memo: Option<String>,
    pub memo_type: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct PaymentOp {
    pub id: String,
    pub paging_token: String,
    #[serde(rename = "type")]
    pub op_type: String,
    pub transaction_hash: String,
    pub asset_type: Option<String>,
    pub asset_code: Option<String>,
    pub asset_issuer: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub amount: Option<String>,
    // Still present for the non-wallet harness path (scripts/testnet-harness/pay.js),
    // which signs directly against a muxed destination without going through
    // Freighter — that path never hit the wallet bug, so it's left as a
    // fallback rather than removed.
    pub to_muxed: Option<String>,
    pub to_muxed_id: Option<String>,
    pub transaction: Option<EmbeddedTransaction>,
}

#[derive(Debug, Deserialize)]
struct Embedded {
    records: Vec<PaymentOp>,
}

#[derive(Debug, Deserialize)]
struct PaymentsResponse {
    #[serde(rename = "_embedded")]
    embedded: Embedded,
}

pub struct HorizonClient {
    base_url: String,
    http: reqwest::Client,
}

impl HorizonClient {
    pub fn new(base_url: &str) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            http: reqwest::Client::new(),
        }
    }

    pub async fn payments_since(&self, account: &str, cursor: &str, limit: u32) -> Result<Vec<PaymentOp>> {
        let url = format!(
            "{}/accounts/{}/payments?cursor={}&order=asc&limit={}&join=transactions",
            self.base_url, account, cursor, limit
        );
        let resp = self
            .http
            .get(&url)
            .header("Accept", "application/json")
            .send()
            .await
            .context("horizon request failed")?
            .error_for_status()
            .context("horizon returned an error status")?
            .json::<PaymentsResponse>()
            .await
            .context("failed to parse horizon payments response")?;
        Ok(resp.embedded.records)
    }

    /// Resolves the special 'now' cursor to the account's current latest
    /// paging_token, so the reconciler only ever sees payments that land
    /// *after* it started — never from an arbitrary hardcoded value, and
    /// never from true zero on an account with real history.
    pub async fn resolve_now_cursor(&self, account: &str) -> Result<String> {
        let url = format!(
            "{}/accounts/{}/payments?order=desc&limit=1",
            self.base_url, account
        );
        let resp = self
            .http
            .get(&url)
            .header("Accept", "application/json")
            .send()
            .await
            .context("horizon request failed while resolving now-cursor")?
            .error_for_status()
            .context("horizon returned an error status while resolving now-cursor")?
            .json::<PaymentsResponse>()
            .await
            .context("failed to parse horizon response while resolving now-cursor")?;
        Ok(resp
            .embedded
            .records
            .first()
            .map(|r| r.paging_token.clone())
            .unwrap_or_else(|| "0".to_string()))
    }
}
