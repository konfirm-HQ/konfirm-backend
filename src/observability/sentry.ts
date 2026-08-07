import * as Sentry from '@sentry/node';

// Entirely opt-in via SENTRY_DSN — this pilot has never had a Sentry
// project, so this can't be "proven" the way everything else in this
// project has been proven against a real service. What's real: the
// integration itself, wired so that setting one env var in production
// activates it with no code change. Without a DSN it's a documented no-op,
// not a silent gap.
export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    // eslint-disable-next-line no-console
    console.warn('[observability] SENTRY_DSN not set — error tracking is a no-op. Fine for local dev, not for anything beyond it.');
    return;
  }
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: 0.1,
  });
}

export function captureException(err: unknown): void {
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(err);
  }
}
