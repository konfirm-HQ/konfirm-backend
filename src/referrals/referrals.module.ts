import { Module } from '@nestjs/common';
import { ReferralRewardsService } from './referral-rewards.service';

@Module({
  providers: [ReferralRewardsService],
})
export class ReferralsModule {}
