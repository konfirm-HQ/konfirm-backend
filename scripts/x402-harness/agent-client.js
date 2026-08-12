// Stands in for an AI agent paying for an API — the official @x402/fetch +
// @x402/stellar client packages, unmodified, per skills.stellar.org's
// agentic-payments skill "Buyer" example. Everything here is standard x402
// client code; the only Konfirm-specific piece is which facilitator the
// resource server (resource-server.js) happens to be configured to call.
import "dotenv/config";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";

const NETWORK = "stellar:testnet";
const RESOURCE_URL = process.argv[2] || "http://localhost:4021/paid-resource";

const secretKey = process.env.STELLAR_SECRET_KEY;
if (!secretKey) {
  throw new Error("STELLAR_SECRET_KEY is required — run setup.js first, then fund it with testnet USDC (see setup.js output).");
}

// createEd25519Signer takes the raw S... secret string and the CAIP-2
// network id directly — not a Keypair, not a pre-resolved passphrase (the
// signer does both internally). Confirmed pitfall from the same skill.
const signer = createEd25519Signer(secretKey, NETWORK);

const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: NETWORK, client: new ExactStellarScheme(signer) }],
});

async function main() {
  console.log(`paying ${signer.address} -> ${RESOURCE_URL} ...`);
  const res = await fetchWithPayment(RESOURCE_URL);
  const body = await res.json().catch(() => null);

  console.log(JSON.stringify({ status: res.status, body }, null, 2));

  const settleHeader = res.headers.get("PAYMENT-RESPONSE") || res.headers.get("X-PAYMENT-RESPONSE");
  if (settleHeader) {
    const decoded = JSON.parse(Buffer.from(settleHeader, "base64").toString("utf8"));
    console.log("\nsettlement:");
    console.log(JSON.stringify(decoded, null, 2));
    if (decoded.transaction) {
      console.log(`\nexplorer: https://stellar.expert/explorer/testnet/tx/${decoded.transaction}`);
    }
  }
}

main().catch((err) => {
  console.error(err.response?.data ?? err);
  process.exit(1);
});
