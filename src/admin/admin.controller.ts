import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../zod-validation.pipe';
import { AdminGuard, AuthedAdminRequest } from '../admin-auth/admin-auth.guard';
import { AdminMerchantsService } from './admin-merchants.service';
import { AdminActionsService } from './admin-actions.service';
import { AdminStatsService } from './admin-stats.service';
import { AdminPaymentsService } from './admin-payments.service';
import { AdminComplianceService } from './admin-compliance.service';
import { AdminReconcilerService } from './admin-reconciler.service';
import { AdminWithdrawalAttemptsService } from './admin-withdrawal-attempts.service';

const setMerchantStatusSchema = z.object({
  status: z.enum(['active', 'suspended']),
  reason: z.string().max(500).optional(),
});

const setPaymentStatusSchema = z.object({
  status: z.enum(['paid', 'held', 'disputed']),
  reason: z.string().max(500).optional(),
});

const blockAddressSchema = z.object({
  stellar_address: z.string().regex(/^G[A-Z2-7]{55}$/, 'must be a valid Stellar G... address'),
  reason: z.string().max(500).optional(),
});

const rewindCursorSchema = z.object({
  cursor: z.string().min(1),
});

// One controller for the whole admin resource surface rather than one per
// domain — ~25 endpoints across 5 resources doesn't need 5 separate
// module/controller/service triads to stay readable; splitting further
// would be ceremony, not clarity. Each resource still gets its own service
// for testability.
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly merchants: AdminMerchantsService,
    private readonly actions: AdminActionsService,
    private readonly stats: AdminStatsService,
    private readonly payments: AdminPaymentsService,
    private readonly compliance: AdminComplianceService,
    private readonly reconciler: AdminReconcilerService,
    private readonly withdrawalAttempts: AdminWithdrawalAttemptsService,
  ) {}

  @Get('stats')
  getStats() {
    return this.stats.get();
  }

  // --- Merchants ---

  @Get('merchants')
  listMerchants(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.merchants.list(limit ? Number(limit) : undefined, offset ? Number(offset) : undefined);
  }

  @Patch('merchants/:id/status')
  async setMerchantStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setMerchantStatusSchema)) body: z.infer<typeof setMerchantStatusSchema>,
    @Req() req: AuthedAdminRequest,
  ) {
    const merchant = await this.merchants.setStatus(id, body.status);
    await this.actions.log(req.admin.id, `merchant.${body.status === 'suspended' ? 'suspend' : 'reactivate'}`, 'merchant', id, {
      reason: body.reason,
    });
    return merchant;
  }

  // --- Payments ---

  @Get('payments')
  listPayments(@Query('status') status?: string, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.payments.list(status, limit ? Number(limit) : undefined, offset ? Number(offset) : undefined);
  }

  @Patch('payments/:id/status')
  async setPaymentStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setPaymentStatusSchema)) body: z.infer<typeof setPaymentStatusSchema>,
    @Req() req: AuthedAdminRequest,
  ) {
    const payment = await this.payments.setStatus(id, body.status);
    await this.actions.log(req.admin.id, `payment.set-status.${body.status}`, 'payment', id, { reason: body.reason });
    return payment;
  }

  // --- Compliance ---

  @Get('compliance/blocked-addresses')
  listBlockedAddresses() {
    return this.compliance.list();
  }

  @Post('compliance/blocked-addresses')
  async blockAddress(
    @Body(new ZodValidationPipe(blockAddressSchema)) body: z.infer<typeof blockAddressSchema>,
    @Req() req: AuthedAdminRequest,
  ) {
    const blocked = await this.compliance.block(body.stellar_address, req.admin.id, body.reason);
    await this.actions.log(req.admin.id, 'compliance.block-address', 'stellar_address', body.stellar_address, { reason: body.reason });
    return blocked;
  }

  @Delete('compliance/blocked-addresses/:id')
  async unblockAddress(@Param('id') id: string, @Req() req: AuthedAdminRequest) {
    await this.compliance.unblock(id);
    await this.actions.log(req.admin.id, 'compliance.unblock-address', 'blocked_address', id);
    return { ok: true };
  }

  // --- Reconciler ---

  @Get('reconciler/status')
  getReconcilerStatus() {
    return this.reconciler.status();
  }

  // Backward-only, enforced in AdminReconcilerService — the exact "never
  // advance past unprocessed payments" rule from docs/RUNBOOK.md §4.
  @Post('reconciler/rewind')
  async rewindReconciler(
    @Body(new ZodValidationPipe(rewindCursorSchema)) body: z.infer<typeof rewindCursorSchema>,
    @Req() req: AuthedAdminRequest,
  ) {
    const result = await this.reconciler.rewind(body.cursor);
    await this.actions.log(req.admin.id, 'reconciler.rewind', 'reconciler_cursor', 'cursor', {
      previous: result.previous,
      new: body.cursor,
    });
    return result;
  }

  // --- Withdrawal attempts ---

  @Get('withdrawal-attempts')
  listWithdrawalAttempts() {
    return this.withdrawalAttempts.list();
  }

  // Surfaced back to the admin UI as a recent-activity feed rather than
  // just written and forgotten — an audit log nobody reads back isn't
  // accountability, it's a checkbox.
  @Get('activity')
  recentActivity(@Query('limit') limit?: string) {
    return this.actions.recent(limit ? Number(limit) : undefined);
  }
}
