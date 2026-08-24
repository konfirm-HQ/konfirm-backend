import { claimPayload, verifyClaimSignature } from './channel-claim';

// This exact vector was extracted from konfirm-contracts'
// checkpoint_accepts_a_real_signed_claim test (a temporary debug print,
// removed after capturing this) — a real Ed25519 keypair signing a real
// claim_payload byte sequence inside the actual Soroban contract test
// environment, not hand-computed. If claimPayload's encoding ever drifts
// from what the Rust contract computes, this signature stops verifying —
// that's the whole point of pinning a real vector rather than only testing
// against payloads this same file also generated.
const REAL_VECTOR = {
  channelId: 1n,
  nonce: 1n,
  cumulativeAmount: 1_000_000n,
  payerPubkey: Buffer.from('ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c', 'hex'),
  signature: Buffer.from(
    'ac3b9adaea39f03feb07d5d8ea1941a37e5af0c2cd29c8bb4d036704f924847175287e903c934a1b01ca041319df00db021c61b08a9860a71e06f093ab652a02',
    'hex',
  ),
  expectedPayloadHex: '4b4f4e4649524d5f4348414e5f563100000000000000010000000000000001000000000000000000000000000f4240',
};

describe('claimPayload', () => {
  it('matches the exact byte layout the contract signs (real Rust-signed vector)', () => {
    const payload = claimPayload(REAL_VECTOR.channelId, REAL_VECTOR.nonce, REAL_VECTOR.cumulativeAmount);
    expect(payload.length).toBe(47);
    expect(payload.toString('hex')).toBe(REAL_VECTOR.expectedPayloadHex);
  });
});

describe('verifyClaimSignature', () => {
  it('accepts a real signature produced by the actual Soroban contract test', () => {
    expect(
      verifyClaimSignature({
        channelId: REAL_VECTOR.channelId,
        nonce: REAL_VECTOR.nonce,
        cumulativeAmount: REAL_VECTOR.cumulativeAmount,
        payerPubkey: REAL_VECTOR.payerPubkey,
        signature: REAL_VECTOR.signature,
      }),
    ).toBe(true);
  });

  it('rejects the same signature against a different amount', () => {
    expect(
      verifyClaimSignature({
        channelId: REAL_VECTOR.channelId,
        nonce: REAL_VECTOR.nonce,
        cumulativeAmount: REAL_VECTOR.cumulativeAmount + 1n,
        payerPubkey: REAL_VECTOR.payerPubkey,
        signature: REAL_VECTOR.signature,
      }),
    ).toBe(false);
  });

  it('rejects the same signature against a different nonce', () => {
    expect(
      verifyClaimSignature({
        channelId: REAL_VECTOR.channelId,
        nonce: REAL_VECTOR.nonce + 1n,
        cumulativeAmount: REAL_VECTOR.cumulativeAmount,
        payerPubkey: REAL_VECTOR.payerPubkey,
        signature: REAL_VECTOR.signature,
      }),
    ).toBe(false);
  });

  it('rejects the same signature against a different channel id', () => {
    expect(
      verifyClaimSignature({
        channelId: REAL_VECTOR.channelId + 1n,
        nonce: REAL_VECTOR.nonce,
        cumulativeAmount: REAL_VECTOR.cumulativeAmount,
        payerPubkey: REAL_VECTOR.payerPubkey,
        signature: REAL_VECTOR.signature,
      }),
    ).toBe(false);
  });

  it('rejects a well-formed signature under the wrong public key', () => {
    const wrongKey = Buffer.from(REAL_VECTOR.payerPubkey);
    wrongKey[0] ^= 0xff;
    expect(
      verifyClaimSignature({
        channelId: REAL_VECTOR.channelId,
        nonce: REAL_VECTOR.nonce,
        cumulativeAmount: REAL_VECTOR.cumulativeAmount,
        payerPubkey: wrongKey,
        signature: REAL_VECTOR.signature,
      }),
    ).toBe(false);
  });
});
