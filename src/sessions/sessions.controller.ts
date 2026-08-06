import { Body, Controller, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../zod-validation.pipe';
import { SessionsService } from './sessions.service';

const reserveSchema = z.object({
  muxed_id: z.string().regex(/^\d+$/, 'must be a stringified u64'),
});

@Controller('links/:linkId/sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Post()
  reserve(
    @Param('linkId') linkId: string,
    @Body(new ZodValidationPipe(reserveSchema)) body: z.infer<typeof reserveSchema>,
  ) {
    return this.sessions.reserve(linkId, body.muxed_id);
  }
}
