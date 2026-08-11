use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

// Same deployed Soroban contract payments.service.ts already calls from the
// Node side for the Freighter checkout path — kept as a plain duplicated
// constant rather than shared config, matching how the Node side hardcodes
// it too rather than making it env-configurable.
const COMPLIANCE_CONTRACT_ID: &str = "CDDVLE2DZQAYFY3Z2Z74TUNNPC4ROUACSBXOB2P64IT75EZFAQXSRSXY";
const CHECK_TIMEOUT: Duration = Duration::from_secs(8);
const RETRY_DELAY: Duration = Duration::from_millis(500);

/// Screens a payer address against the on-chain compliance contract, for
/// SEP-7/QR payments the reconciler has just observed — the one checkout
/// path that can never be screened before the fact (see store.rs's
/// record_payment_if_new doc comment for why this runs decoupled from the
/// poll loop rather than inline).
///
/// Always returns a plain bool, never an error — matching the Node side's
/// documented invariant exactly: an unreachable compliance check must never
/// silently block anything, but it must never be silent about it either.
/// One retry after a single transient blip, then fails open with a logged
/// warning, same as payments.service.ts's isAllowedOnChain.
pub async fn is_allowed_on_chain(address: &str) -> bool {
    for attempt in 0..2 {
        if attempt > 0 {
            tokio::time::sleep(RETRY_DELAY).await;
        }
        match run_check(address).await {
            Ok(allowed) => return allowed,
            Err(err) => {
                tracing::warn!(address, attempt, error = %err, "compliance check attempt failed");
            }
        }
    }
    tracing::warn!(address, "on-chain compliance check unreachable after retry, failing open");
    true
}

async fn run_check(address: &str) -> anyhow::Result<bool> {
    // A raw secret key in production (STELLAR_DEPLOYER_SECRET_KEY, set as a
    // deploy-time env var — no interactive `stellar keys add` step is
    // possible in a container, confirmed by hand: `--secret-key` requires a
    // real TTY prompt, even piped stdin doesn't satisfy it), or the locally
    // pre-registered 'deployer' identity in dev. One code path, matching
    // payments.service.ts's isAllowedOnChain exactly.
    let source_account = std::env::var("STELLAR_DEPLOYER_SECRET_KEY").unwrap_or_else(|_| "deployer".to_string());

    let output = timeout(
        CHECK_TIMEOUT,
        Command::new("stellar")
            .args([
                "contract",
                "invoke",
                "--id",
                COMPLIANCE_CONTRACT_ID,
                "--source-account",
                &source_account,
                "--network",
                "testnet",
                "--",
                "is_allowed",
                "--addr",
                address,
            ])
            .kill_on_drop(true)
            .output(),
    )
    .await??;

    if !output.status.success() {
        anyhow::bail!(
            "stellar CLI exited with {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim() == "true")
}
