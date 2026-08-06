import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { LinksModule } from './links/links.module';
import { SessionsModule } from './sessions/sessions.module';
import { PaymentsModule } from './payments/payments.module';
import { PagesModule } from './pages/pages.module';
import { WithdrawalsModule } from './withdrawals/withdrawals.module';

@Module({
  imports: [AuthModule, LinksModule, SessionsModule, PaymentsModule, WithdrawalsModule, PagesModule],
})
export class AppModule {}
