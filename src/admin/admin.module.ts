import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { WithdrawalsModule } from '../withdrawals/withdrawals.module';
import { AdminController } from './admin.controller';
import { AdminMerchantsService } from './admin-merchants.service';
import { AdminActionsService } from './admin-actions.service';
import { AdminStatsService } from './admin-stats.service';
import { AdminPaymentsService } from './admin-payments.service';
import { AdminComplianceService } from './admin-compliance.service';
import { AdminReconcilerService } from './admin-reconciler.service';
import { AdminWithdrawalAttemptsService } from './admin-withdrawal-attempts.service';

@Module({
  imports: [AdminAuthModule, WithdrawalsModule],
  controllers: [AdminController],
  providers: [
    AdminMerchantsService,
    AdminActionsService,
    AdminStatsService,
    AdminPaymentsService,
    AdminComplianceService,
    AdminReconcilerService,
    AdminWithdrawalAttemptsService,
  ],
})
export class AdminModule {}
