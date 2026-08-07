import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { z } from 'zod';
import { ZodValidationPipe } from '../zod-validation.pipe';
import { AuthService } from './auth.service';
import { AuthedRequest, AuthGuard, SESSION_COOKIE } from './auth.guard';

// Password-guessing and account-creation-spam both live here — 10/min per
// IP is generous for a real user, punishing for a script.
const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'password must be at least 8 characters'),
  name: z.string().min(1).max(200),
  // Stellar strkey account id — base32, no checksum validation here; a
  // malformed address fails loudly the first time a payout is attempted,
  // which is an acceptable place for that error to surface for a pilot.
  stellar_base_address: z.string().regex(/^G[A-Z2-7]{55}$/, 'must be a valid Stellar G... address'),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// 30 days, matching the JWT's own expiry in auth.service.ts.
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('signup')
  @Throttle(AUTH_THROTTLE)
  async signup(
    @Body(new ZodValidationPipe(signupSchema)) body: z.infer<typeof signupSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, merchant } = await this.auth.signup(body.email, body.password, body.name, body.stellar_base_address);
    this.setSessionCookie(res, token);
    return { merchant };
  }

  @Post('login')
  @HttpCode(200)
  @Throttle(AUTH_THROTTLE)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: z.infer<typeof loginSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, merchant } = await this.auth.login(body.email, body.password);
    this.setSessionCookie(res, token);
    return { merchant };
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(SESSION_COOKIE);
    return { ok: true };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@Req() req: AuthedRequest) {
    return { merchant: req.merchant };
  }

  private setSessionCookie(res: Response, token: string) {
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      // Not marked `secure` because the pilot runs over plain http on
      // localhost — this must flip to true the moment this is served over
      // HTTPS, or the cookie should stop being sent at all.
      maxAge: COOKIE_MAX_AGE_MS,
    });
  }
}
