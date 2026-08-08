import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AdminAuthService, AdminClaims } from './admin-auth.service';

export interface AuthedAdminRequest extends Request {
  admin: AdminClaims;
}

// A distinct cookie name from the merchant session (konfirm_session) so the
// two can never collide or be confused, even in the same browser.
const COOKIE_NAME = 'konfirm_admin_session';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly adminAuth: AdminAuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthedAdminRequest>();
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) throw new UnauthorizedException('log in to continue');
    req.admin = this.adminAuth.verifyToken(token);
    return true;
  }
}

export const ADMIN_SESSION_COOKIE = COOKIE_NAME;
