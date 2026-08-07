import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { captureException } from './sentry';

// Every HttpException (400s, 401s, the deliberate 409 on a muxed_id
// collision, etc.) is expected application flow, not an incident — those
// pass through unchanged and unreported. Anything else is by definition a
// bug or an unhandled failure from an external call, which is exactly what
// should page someone, not just show up as a generic 500 in a log no one's
// watching.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(AllExceptionsFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      res.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    this.logger.error({ err: exception }, 'unhandled exception');
    captureException(exception);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'internal server error',
    });
  }
}
