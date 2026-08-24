import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { ZodValidationPipe } from '../zod-validation.pipe';
import { ChannelService } from './channel.service';

// channel_id/nonce/cumulative_amount travel as decimal strings (JSON has no
// bigint) — validated as digit strings here, converted to BigInt at the
// service boundary. Signature as hex, matching how it's stored internally
// (src/common/channel-claim.ts, x402_channels.pending_signature).
const claimSchema = z.object({
  channel_id: z.string().regex(/^\d+$/, 'must be a non-negative integer string'),
  cumulative_amount: z.string().regex(/^\d+$/, 'must be a non-negative integer string'),
  nonce: z.string().regex(/^\d+$/, 'must be a non-negative integer string'),
  signature: z.string().regex(/^[0-9a-fA-F]{128}$/, 'must be a 64-byte hex-encoded ed25519 signature'),
});

// Same no-AuthGuard reasoning as x402.controller.ts — called by parties
// with no prior relationship to Konfirm. Sits at the same 20/60s tier as
// /x402/verify+/settle for /open (a real Soroban submission), but /claim
// gets the cheaper 60/60s no-RPC tier since it costs a Postgres round-trip
// and a local signature check, not a network call — the first endpoint in
// this codebase to actually need that third throttle tier.
@Controller('x402/channel')
export class ChannelController {
  constructor(private readonly channel: ChannelService) {}

  @Post('claim')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async claim(@Body(new ZodValidationPipe(claimSchema)) body: z.infer<typeof claimSchema>) {
    const result = await this.channel.claim({
      onchainChannelId: BigInt(body.channel_id),
      cumulativeAmount: BigInt(body.cumulative_amount),
      nonce: BigInt(body.nonce),
      signature: Buffer.from(body.signature, 'hex'),
    });
    if (!result.accepted) {
      throw new BadRequestException(result.reason ?? 'claim_rejected');
    }
    return { accepted: true };
  }
}
