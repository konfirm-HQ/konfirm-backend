import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminController } from './admin.controller';
import { AdminMerchantsService } from './admin-merchants.service';
import { AdminActionsService } from './admin-actions.service';
import { AdminStatsService } from './admin-stats.service';

@Module({
  imports: [AdminAuthModule],
  controllers: [AdminController],
  providers: [AdminMerchantsService, AdminActionsService, AdminStatsService],
})
export class AdminModule {}
