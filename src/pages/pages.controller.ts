import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

@Controller()
export class PagesController {
  private serve(res: Response, filename: string) {
    const html = readFileSync(join(__dirname, '..', '..', 'public', filename), 'utf8');
    res.set('Cache-Control', 'no-store');
    res.type('html').send(html);
  }

  @Get('login')
  login(@Res() res: Response) {
    this.serve(res, 'login.html');
  }

  @Get('signup')
  signup(@Res() res: Response) {
    this.serve(res, 'signup.html');
  }

  @Get('new')
  newPayment(@Res() res: Response) {
    this.serve(res, 'new.html');
  }

  @Get('pay/:linkId')
  checkout(@Param('linkId') linkId: string, @Res() res: Response) {
    const html = readFileSync(join(__dirname, '..', '..', 'public', 'pay.html'), 'utf8').replace(
      '%%LINK_ID%%',
      linkId,
    );
    // These pages are read fresh from disk on every request specifically so
    // fixes land immediately — a cached copy in the browser defeats that
    // entirely and is exactly what caused a fixed bug to keep reappearing.
    res.set('Cache-Control', 'no-store');
    res.type('html').send(html);
  }

  @Get('activity')
  activity(@Res() res: Response) {
    this.serve(res, 'activity.html');
  }

  @Get('cashout')
  cashout(@Res() res: Response) {
    this.serve(res, 'cashout.html');
  }
}
