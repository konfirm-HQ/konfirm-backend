import 'dotenv/config';
import 'reflect-metadata';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import express from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
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
