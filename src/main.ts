import 'dotenv/config';
import 'reflect-metadata';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import express from 'express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { initSentry } from './observability/sentry';

async function bootstrap() {
  initSentry();
  // bufferLogs holds anything logged before the pino logger takes over
  // (below) and replays it through pino instead of dropping it or falling
  // back to Nest's plain console logger for just those first few lines.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.use(cookieParser());
  // Vendored, not CDN-loaded — the QR encoder needs to be servable without
  // depending on a third-party host being up or matching a guessed shape.
  app.use('/vendor', express.static(join(__dirname, '..', 'public', 'vendor')));
  // Express auto-generates ETags for every response by default, which lets
  // a browser skip re-fetching via a conditional request — a second,
  // independent caching path beyond Cache-Control that would reproduce the
  // exact same "fix didn't take" symptom on its own.
  app.getHttpAdapter().getInstance().set('etag', false);
  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`konfirm-backend listening on :${port}`);
}
bootstrap();
