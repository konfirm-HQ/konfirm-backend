import { Injectable, Logger } from '@nestjs/common';
import { pool } from '../db/pool';
import { verifyClaimSignature } from '../common/channel-claim';

export interface ClaimResult {
  accepted: boolean;
  reason?: string;
}

@Injectable()
export class ChannelService {
  private readonly logger = new Logger(ChannelService.name);

  // The fast path: hit once per request instead of /x402/settle once a
  // channel is open. No RPC call anywhere in here — the whole point of
  // netting is that this costs a Postgres round-trip and a local ed25519
  // verification, not a Soroban simulation + submission. The channel's
  // actual on-chain checkpoint only happens later, via the keeper.
  async claim(params: {
    onchainChannelId: bigint;
    cumulativeAmount: bigint;
    nonce: bigint;
    signature: Buffer;
  }): Promise<ClaimResult> {
    const { rows } = await pool.query(
      `SELECT payer_pubkey, deposited, pending_amount, pending_nonce, status
       FROM x402_channels WHERE onchain_channel_id = $1`,
      [params.onchainChannelId.toString()],
    );
    if (rows.length === 0) {
      return { accepted: false, reason: 'channel_not_found' };
    }
    const row = rows[0] as {
      payer_pubkey: string;
      deposited: string;
      pending_amount: string;
      pending_nonce: string;
      status: string;
    };

    // Once a channel is winding down, the off-chain fast path stops
    // extending new credit — this endpoint is for accumulating claims
    // during normal operation, not for negotiating a dispute (that's the
    // on-chain checkpoint() call itself, driven by the keeper).
    if (row.status !== 'open') {
      return { accepted: false, reason: 'channel_not_open' };
    }

    const pendingAmount = BigInt(row.pending_amount);
    const pendingNonce = BigInt(row.pending_nonce);
    const deposited = BigInt(row.deposited);

    // Same monotonicity + capacity checks the contract itself enforces in
    // checkpoint() — mirrored here so a bad claim never even gets stored,
    // not just eventually rejected on-chain.
    if (params.nonce <= pendingNonce || params.cumulativeAmount <= pendingAmount) {
      return { accepted: false, reason: 'stale_claim' };
    }
    if (params.cumulativeAmount > deposited) {
      return { accepted: false, reason: 'exceeds_deposit' };
    }

    const valid = verifyClaimSignature({
      channelId: params.onchainChannelId,
      nonce: params.nonce,
      cumulativeAmount: params.cumulativeAmount,
      payerPubkey: Buffer.from(row.payer_pubkey, 'hex'),
      signature: params.signature,
    });
    if (!valid) {
      this.logger.warn(`rejected claim with invalid signature for channel ${params.onchainChannelId}`);
      return { accepted: false, reason: 'invalid_signature' };
    }

    await pool.query(
      `UPDATE x402_channels
       SET pending_amount = $2, pending_nonce = $3, pending_signature = $4, last_activity_at = NOW(), updated_at = NOW()
       WHERE onchain_channel_id = $1`,
      [params.onchainChannelId.toString(), params.cumulativeAmount.toString(), params.nonce.toString(), params.signature.toString('hex')],
    );

    return { accepted: true };
  }
}
