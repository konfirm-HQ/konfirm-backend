import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { LinksModule } from './links/links.module';
import { SessionsModule } from './sessions/sessions.module';
import { PaymentsModule } from './payments/payments.module';
import { PagesModule } from './pages/pages.module';
import { WithdrawalsModule } from './withdrawals/withdrawals.module';
import { DepositsModule } from './deposits/deposits.module';

@Module({
  imports: [
    // A global default (60/min per IP) covers every route with no extra
    // work; auth and payment-adjacent routes tighten this individually
    // with @Throttle() since brute-forcing a password or hammering an
    // external anchor/RPC needs a much lower ceiling than reading a public
    // link.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    AuthModule,
    LinksModule,
    SessionsModule,
    PaymentsModule,
    WithdrawalsModule,
    DepositsModule,
    PagesModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
