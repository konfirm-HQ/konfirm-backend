// Fires many real, validly-signed claims at /x402/channel/claim
// concurrently, against the real live testnet channel, to check two
// things: (1) raw throughput of the no-RPC fast path, and (2) whether the
// final stored state actually reflects the highest nonce/amount seen, or
// whether a race in channel.service.ts's read-check-then-unconditional-
// write lets an out-of-order claim clobber a newer one.
import "dotenv/config";
import { sign as ed25519Sign } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";

const FACILITATOR_URL = process.env.FACILITATOR_URL || "http://localhost:4001";
const CHANNEL_ID = process.argv[2] || "1";
const COUNT = Number(process.argv[3] || 20);
const START_NONCE = BigInt(process.argv[4] || 1);
const STEP_AMOUNT = BigInt(process.argv[5] || 100_000); // 0.01 USDC per step at 7dp

const kp = Keypair.fromSecret(process.env.STELLAR_SECRET_KEY);

const DOMAIN_TAG = Buffer.from("KONFIRM_CHAN_V1", "ascii");
// PKCS8 DER wrapper for a raw 32-byte ed25519 seed (per channel-claim.ts's
// companion note in konfirm-netting-engine memory) so Node's crypto can
// sign with it directly.
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function i128ToBEBytes(value) {
  let x = BigInt.asUintN(128, value);
  const buf = Buffer.alloc(16);
  for (let i = 15; i >= 0; i--) {
    buf[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return buf;
}
function u64ToBEBytes(value) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt.asUintN(64, value));
  return buf;
}
function claimPayload(channelId, nonce, cumulativeAmount) {
  return Buffer.concat([DOMAIN_TAG, u64ToBEBytes(channelId), u64ToBEBytes(nonce), i128ToBEBytes(cumulativeAmount)]);
}

const privateKeyDer = Buffer.concat([PKCS8_PREFIX, kp.rawSecretKey()]);
const privateKey = { key: privateKeyDer, format: "der", type: "pkcs8" };

async function fireClaim(nonce, amount) {
  const signature = ed25519Sign(null, claimPayload(BigInt(CHANNEL_ID), nonce, amount), privateKey);
  const start = Date.now();
  const res = await fetch(`${FACILITATOR_URL}/x402/channel/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      channel_id: CHANNEL_ID,
      cumulative_amount: amount.toString(),
      nonce: nonce.toString(),
      signature: signature.toString("hex"),
    }),
  });
  const body = await res.json().catch(() => null);
  return { nonce: nonce.toString(), amount: amount.toString(), status: res.status, ms: Date.now() - start, body };
}

async function main() {
  console.log(`firing ${COUNT} concurrent claims at ${FACILITATOR_URL}/x402/channel/claim (channel ${CHANNEL_ID})...\n`);
  const jobs = [];
  for (let i = 0; i < COUNT; i++) {
    const nonce = START_NONCE + BigInt(i);
    const amount = (BigInt(i) + 1n) * STEP_AMOUNT;
    jobs.push(fireClaim(nonce, amount));
  }
  const results = await Promise.all(jobs);
  const accepted = results.filter((r) => r.status === 200 || r.body?.accepted).length;
  const latencies = results.map((r) => r.ms).sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p99 = latencies[Math.floor(latencies.length * 0.99)];

  console.log(`accepted: ${accepted}/${COUNT}`);
  console.log(`latency p50=${p50}ms p99=${p99}ms max=${latencies[latencies.length - 1]}ms`);
  console.log(`\nrejections:`);
  for (const r of results.filter((r) => !(r.status === 200 || r.body?.accepted))) {
    console.log(`  nonce=${r.nonce} amount=${r.amount}: ${JSON.stringify(r.body)}`);
  }

  const expectedFinalNonce = (START_NONCE + BigInt(COUNT) - 1n).toString();
  const expectedFinalAmount = (BigInt(COUNT) * STEP_AMOUNT).toString();
  console.log(`\nexpected final state if no race: nonce=${expectedFinalNonce} amount=${expectedFinalAmount}`);
  console.log(`(compare against the real DB row after this script exits)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
