import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { ZodValidationPipe } from '../zod-validation.pipe';
import { DepositsService } from './deposits.service';

const tokenSchema = z.object({ transaction: z.string().min(1) });
const startSchema = z.object({
  currency: z.enum(['XLM', 'USDC']),
  token: z.string().min(1),
  account: z.string().regex(/^G[A-Z2-7]{55}$/),
});
const transferSchema = z.object({
  from: z.string().regex(/^G[A-Z2-7]{55}$/),
  to: z.string().regex(/^G[A-Z2-7]{55}$/),
  currency: z.enum(['XLM', 'USDC']),
  amount: z.string().regex(/^\d+(\.\d{1,7})?$/),
});

// No AuthGuard anywhere here — this exists to get test funds into *any*
// Stellar address, which has no relationship to a Konfirm merchant account.
// That makes rate limiting the *only* protection this controller has
// against being used to hammer the external anchor or Horizon, so it's
// tighter here than on the authenticated withdrawals controller.
@Controller('deposits')
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class DepositsController {
  constructor(private readonly deposits: DepositsService) {}

  @Get('challenge')
  challenge(@Query('account') account: string) {
    if (!account) throw new BadRequestException('account is required');
    return this.deposits.getChallenge(account);
  }

  @Post('token')
  token(@Body(new ZodValidationPipe(tokenSchema)) body: z.infer<typeof tokenSchema>) {
    return this.deposits.exchangeToken(body.transaction);
  }

  @Post('start')
  start(@Body(new ZodValidationPipe(startSchema)) body: z.infer<typeof startSchema>) {
    return this.deposits.startDeposit(body.token, body.currency, body.account);
  }

  // Polled every 3s while a deposit is in progress — same headroom reasoning
  // as withdrawals.controller.ts's status endpoint.
  @Get('status')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  status(@Query('token') token: string, @Query('id') id: string) {
    if (!token || !id) throw new BadRequestException('token and id are both required');
    return this.deposits.getStatus(token, id);
  }

  @Post('transfer-payment')
  prepareTransfer(@Body(new ZodValidationPipe(transferSchema)) body: z.infer<typeof transferSchema>) {
    return this.deposits.prepareTransferPayment(body.from, body.to, body.currency, body.amount);
  }
}
