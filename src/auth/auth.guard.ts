import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService, MerchantClaims } from './auth.service';

export interface AuthedRequest extends Request {
  merchant: MerchantClaims;
}

const COOKIE_NAME = 'konfirm_session';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) throw new UnauthorizedException('log in to continue');
    req.merchant = this.auth.verifyToken(token);
    return true;
  }
}

export const SESSION_COOKIE = COOKIE_NAME;
