import { Module } from '@nestjs/common';
import { X402Controller } from './x402.controller';
import { X402Service } from './x402.service';
import { ChannelController } from './channel.controller';
import { ChannelService } from './channel.service';

@Module({
  controllers: [X402Controller, ChannelController],
  providers: [X402Service, ChannelService],
})
export class X402Module {}
