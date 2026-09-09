// Fires N concurrent real x402 payments at the resource server (which
// forwards verify+settle to whatever KONFIRM_FACILITATOR_URL points at),
// to check how the facilitator behaves when multiple settlements land on
// its own Soroban account at roughly the same time. Real payer key, real
// testnet payments, real money (0.001 USDC each) — not a mock.
import "dotenv/config";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";

const NETWORK = "stellar:testnet";
const RESOURCE_URL = process.env.RESOURCE_URL || "http://localhost:4021/paid-resource";
const CONCURRENCY = Number(process.argv[2] || 5);

const secretKey = process.env.STELLAR_SECRET_KEY;
if (!secretKey) {
  throw new Error("STELLAR_SECRET_KEY is required — see .env / setup.js.");
}

const signer = createEd25519Signer(secretKey, NETWORK);
const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: NETWORK, client: new ExactStellarScheme(signer) }],
});

async function attempt(i) {
  const start = Date.now();
  try {
    const res = await fetchWithPayment(RESOURCE_URL);
    const body = await res.json().catch(() => null);
    return { i, ok: res.status === 200, status: res.status, ms: Date.now() - start, body: res.status === 200 ? undefined : body };
  } catch (err) {
    const detail = err?.response?.data ?? err?.message ?? String(err);
    return { i, ok: false, status: null, ms: Date.now() - start, error: detail };
  }
}

async function main() {
  console.log(`firing ${CONCURRENCY} concurrent payments at ${RESOURCE_URL} ...\n`);
  const results = await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => attempt(i)));
  const ok = results.filter((r) => r.ok).length;
  for (const r of results.sort((a, b) => a.i - b.i)) {
    console.log(
      `#${r.i}: ${r.ok ? "OK  " : "FAIL"} status=${r.status ?? "-"} ${r.ms}ms${
        r.ok ? "" : `  ${JSON.stringify(r.error ?? r.body)}`
      }`,
    );
  }
  console.log(`\n${ok}/${CONCURRENCY} succeeded`);
}

main();
