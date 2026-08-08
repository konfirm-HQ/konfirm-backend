import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../zod-validation.pipe';
import { AdminGuard, AuthedAdminRequest } from '../admin-auth/admin-auth.guard';
import { AdminMerchantsService } from './admin-merchants.service';
import { AdminActionsService } from './admin-actions.service';

const setStatusSchema = z.object({
  status: z.enum(['active', 'suspended']),
  reason: z.string().max(500).optional(),
});

// Slice 1 of the admin workflow: merchant management plus the audit trail
// for it. Deliberately one controller rather than a module per resource —
// with a single resource today, splitting further is ceremony, not clarity.
// Payments review, the compliance blocklist, reconciler status, and
// withdrawal-attempt tracking are a deferred second slice (see the plan).
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly merchants: AdminMerchantsService,
    private readonly actions: AdminActionsService,
  ) {}

  @Get('merchants')
  listMerchants(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.merchants.list(limit ? Number(limit) : undefined, offset ? Number(offset) : undefined);
  }

  @Patch('merchants/:id/status')
  async setMerchantStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setStatusSchema)) body: z.infer<typeof setStatusSchema>,
    @Req() req: AuthedAdminRequest,
  ) {
    const merchant = await this.merchants.setStatus(id, body.status);
    await this.actions.log(req.admin.id, `merchant.${body.status === 'suspended' ? 'suspend' : 'reactivate'}`, 'merchant', id, {
      reason: body.reason,
    });
    return merchant;
  }

  // Surfaced back to the admin UI as a recent-activity feed rather than
  // just written and forgotten — an audit log nobody reads back isn't
  // accountability, it's a checkbox.
  @Get('activity')
  recentActivity(@Query('limit') limit?: string) {
    return this.actions.recent(limit ? Number(limit) : undefined);
  }
}
