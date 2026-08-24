import { createPublicKey, verify as verifyEd25519 } from 'node:crypto';

// Mirrors konfirm-contracts/contracts/channel/src/lib.rs's claim_payload
// exactly — domain tag + big-endian channel_id (u64) + nonce (u64) +
// cumulative_amount (i128). Verified byte-for-byte against a real
// Rust-signed test vector (extracted from the contract's own
// checkpoint_accepts_a_real_signed_claim test) before this was trusted:
// Node's ed25519 verification of that real signature against this exact
// encoding returns true. Get this wrong and every claim either falsely
// rejects (netting breaks) or — far worse — falsely accepts (a forged
// claim pays out), so this stays a single, tested source of truth rather
// than being reimplemented at each call site.
const DOMAIN_TAG = Buffer.from('KONFIRM_CHAN_V1', 'ascii');

// Rust's i128::to_be_bytes() is always a fixed 16-byte, two's-complement,
// big-endian encoding. Node has no built-in primitive at this width —
// BigInt.asUintN(128, value) produces the correct two's-complement bit
// pattern (relevant even though amounts are always non-negative in
// practice, since the bit pattern for a positive value under two's
// complement is just zero-padding, but getting the conversion itself
// right matters), then it's shifted out 8 bits at a time into a Buffer.
function i128ToBEBytes(value: bigint): Buffer {
  let x = BigInt.asUintN(128, value);
  const buf = Buffer.alloc(16);
  for (let i = 15; i >= 0; i--) {
    buf[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return buf;
}

function u64ToBEBytes(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt.asUintN(64, value));
  return buf;
}

export function claimPayload(channelId: bigint, nonce: bigint, cumulativeAmount: bigint): Buffer {
  return Buffer.concat([DOMAIN_TAG, u64ToBEBytes(channelId), u64ToBEBytes(nonce), i128ToBEBytes(cumulativeAmount)]);
}

// Ed25519 raw public keys (the 32 bytes Soroban's BytesN<32> stores) need
// wrapping in a standard SPKI DER envelope before Node's crypto module will
// accept them — this is that fixed, algorithm-identifying prefix, not
// something derived per-key.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export function verifyClaimSignature(params: {
  channelId: bigint;
  nonce: bigint;
  cumulativeAmount: bigint;
  payerPubkey: Buffer;
  signature: Buffer;
}): boolean {
  const payload = claimPayload(params.channelId, params.nonce, params.cumulativeAmount);
  const spki = Buffer.concat([ED25519_SPKI_PREFIX, params.payerPubkey]);
  const publicKey = createPublicKey({ key: spki, format: 'der', type: 'spki' });
  return verifyEd25519(null, payload, publicKey, params.signature);
}
