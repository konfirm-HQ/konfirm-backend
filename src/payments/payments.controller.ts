import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  // Shells out to the `stellar` CLI (compliance check) and calls Horizon —
  // both real external processes/services, not a cheap DB read. 20/min per
  // IP is far more than a real checkout attempt ever needs.
  @Get('prepare-tx')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  prepareTx(
    @Query('linkId') linkId: string,
    @Query('muxed_id') muxedId: string,
    @Query('payer') payer: string,
  ) {
    if (!linkId || !muxedId || !payer) {
      throw new BadRequestException('linkId, muxed_id, and payer are all required');
    }
    return this.payments.prepareTx(linkId, muxedId, payer);
  }

  @Get('pay-uri')
  buildPayUri(@Query('linkId') linkId: string, @Query('muxed_id') muxedId: string) {
    if (!linkId || !muxedId) {
      throw new BadRequestException('linkId and muxed_id are both required');
    }
    return this.payments.buildPayUri(linkId, muxedId);
  }

  @Get('by-merchant/:stellarAddress')
  listByMerchant(@Param('stellarAddress') stellarAddress: string) {
    return this.payments.listByMerchantAddress(stellarAddress);
  }

  @Get('pending-by-merchant/:stellarAddress')
  pendingByMerchant(@Param('stellarAddress') stellarAddress: string) {
    return this.payments.hasPendingSession(stellarAddress);
  }
}
