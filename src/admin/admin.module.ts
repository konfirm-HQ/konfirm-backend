import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminController } from './admin.controller';
import { AdminMerchantsService } from './admin-merchants.service';
import { AdminActionsService } from './admin-actions.service';

@Module({
  imports: [AdminAuthModule],
  controllers: [AdminController],
  providers: [AdminMerchantsService, AdminActionsService],
})
export class AdminModule {}
