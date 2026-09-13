import { Module } from '@nestjs/common';
import { BazaarController } from './bazaar.controller';
import { BazaarService } from './bazaar.service';

@Module({
  controllers: [BazaarController],
  providers: [BazaarService],
  exports: [BazaarService],
})
export class BazaarModule {}
