import { Module } from '@nestjs/common';
import { X402Controller } from './x402.controller';
import { X402Service } from './x402.service';

@Module({
  controllers: [X402Controller],
  providers: [X402Service],
})
export class X402Module {}
