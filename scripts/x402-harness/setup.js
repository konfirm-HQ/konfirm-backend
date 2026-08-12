// One-time setup: generates a fresh recipient (resource-server payTo) and
// payer (agent-client) keypair, funds both with testnet XLM, and adds a
// USDC trustline to both. Follows skills.stellar.org's agentic-payments
// skill setup.js sketch verbatim (same steps, same order) — the two
// remaining steps (Circle USDC faucet, since it's a web-only Captcha form
// with no API) are printed at the end for the operator to do by hand.
import fs from "node:fs/promises";
import { Keypair, Horizon, Networks, TransactionBuilder, Operation, Asset, BASE_FEE } from "@stellar/stellar-sdk";

const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const horizon = new Horizon.Server("https://horizon-testnet.stellar.org");

const friendbot = (addr) => fetch(`https://friendbot.stellar.org?addr=${addr}`);

async function addTrustline(kp) {
  const acc = await horizon.loadAccount(kp.publicKey());
  const tx = new TransactionBuilder(acc, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.changeTrust({ asset: new Asset("USDC", USDC_ISSUER) }))
    .setTimeout(60)
    .build();
  tx.sign(kp);
  return horizon.submitTransaction(tx);
}

async function main() {
  const recipient = Keypair.random();
  const payer = Keypair.random();

  process.stderr.write(`funding recipient ${recipient.publicKey()} ...\n`);
  process.stderr.write(`funding payer     ${payer.publicKey()} ...\n`);
  const [rRes, pRes] = await Promise.all([friendbot(recipient.publicKey()), friendbot(payer.publicKey())]);
  if (!rRes.ok || !pRes.ok) throw new Error("friendbot funding failed");

  // friendbot's tx needs a moment to land before loadAccount can see it.
  await new Promise((r) => setTimeout(r, 3000));

  process.stderr.write("adding USDC trustlines to both accounts ...\n");
  await Promise.all([addTrustline(recipient), addTrustline(payer)]);

  await fs.writeFile(
    ".env",
    `KONFIRM_FACILITATOR_URL=https://api-production-cc675.up.railway.app/x402
STELLAR_RECIPIENT=${recipient.publicKey()}
STELLAR_SECRET_KEY=${payer.secret()}
`,
  );

  process.stderr.write("\n.env written.\n\n");
  process.stderr.write("Manual step (web-only, no API — per skills.stellar.org's agentic-payments skill):\n");
  process.stderr.write(`  Fund the PAYER with testnet USDC: https://faucet.circle.com\n`);
  process.stderr.write(`  Select "Stellar testnet", paste this address:\n`);
  process.stderr.write(`  ${payer.publicKey()}\n\n`);
  process.stderr.write("Once funded, run: node resource-server.js  (in one terminal)\n");
  process.stderr.write("             and: node agent-client.js    (in another)\n");
}

main().catch((err) => {
  console.error(err.response?.data ?? err);
  process.exit(1);
});
