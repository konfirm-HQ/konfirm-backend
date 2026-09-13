import { Module } from '@nestjs/common';
import { FacilitatorSpendGuardService } from './facilitator-spend-guard.service';
import { FacilitatorSweepService } from './facilitator-sweep.service';

@Module({
  providers: [FacilitatorSpendGuardService, FacilitatorSweepService],
  exports: [FacilitatorSpendGuardService],
})
export class FacilitatorModule {}
