import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../zod-validation.pipe';
import { AuthedRequest, AuthGuard } from '../auth/auth.guard';
import { WithdrawalsService } from './withdrawals.service';

const tokenSchema = z.object({ transaction: z.string().min(1) });
const startSchema = z.object({ currency: z.enum(['XLM', 'USDC']), token: z.string().min(1) });
const prepareSchema = z.object({
  currency: z.enum(['XLM', 'USDC']),
  token: z.string().min(1),
  id: z.string().min(1),
});

// The account a cash-out moves from is always the logged-in merchant's own
// registered address — never a client-supplied field, for the same reason
// links.controller.ts stopped trusting a client-supplied merchant_id.
@Controller('withdrawals')
@UseGuards(AuthGuard)
export class WithdrawalsController {
  constructor(private readonly withdrawals: WithdrawalsService) {}

  @Get('challenge')
  challenge(@Req() req: AuthedRequest) {
    if (!req.merchant.stellar_base_address) {
      throw new BadRequestException('no Stellar address on file for this account');
    }
    return this.withdrawals.getChallenge(req.merchant.stellar_base_address);
  }

  @Post('token')
  token(@Body(new ZodValidationPipe(tokenSchema)) body: z.infer<typeof tokenSchema>) {
    return this.withdrawals.exchangeToken(body.transaction);
  }

  @Post('start')
  start(@Body(new ZodValidationPipe(startSchema)) body: z.infer<typeof startSchema>, @Req() req: AuthedRequest) {
    return this.withdrawals.startWithdrawal(body.token, body.currency, req.merchant.stellar_base_address!);
  }

  @Get('status')
  status(@Query('token') token: string, @Query('id') id: string) {
    if (!token || !id) throw new BadRequestException('token and id are both required');
    return this.withdrawals.getStatus(token, id);
  }

  @Post('prepare-payment')
  async preparePayment(
    @Body(new ZodValidationPipe(prepareSchema)) body: z.infer<typeof prepareSchema>,
    @Req() req: AuthedRequest,
  ) {
    const txn = await this.withdrawals.getStatus(body.token, body.id);
    return this.withdrawals.prepareWithdrawalTx(req.merchant.stellar_base_address!, body.currency, txn);
  }
}
