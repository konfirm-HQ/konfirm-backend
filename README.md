# konfirm-backend

The API and settlement-watching service behind **Konfirm**, a non-custodial payment processor built on Stellar. This repo is the NestJS API, the Postgres schema, and a Rust reconciler that watches the chain and turns confirmed transactions into records — nothing here ever holds a merchant's or payer's private key.

Sibling repos: [konfirm-contracts](https://github.com/samuel2926i39-art/konfirm-contracts) (Soroban contracts, not yet wired into this API's runtime path) and [konfirm-frontend](https://github.com/samuel2926i39-art/konfirm-frontend) (the pages this service currently serves as a same-origin copy).

## How it works

Konfirm has no "invoice" or "charge" object with a pending lifecycle. A merchant creates a **Link** (amount, currency, description). A payer hits that link, and the checkout page reserves a random session ID, builds a Stellar transaction, and gets it signed by the payer's own wallet — Konfirm never touches a signing key at any point, merchant or payer. A **Payment** row only ever gets written after the reconciler independently observes that transaction confirmed on Horizon; nothing is "pending" in the database because nothing is recorded until it's real.

Two ways to pay a link:
- **Freighter** (browser extension) — the API pre-builds the transaction and Freighter signs it.
- **SEP-7 QR code / mobile wallet** — a `web+stellar:pay` URI, since a Stellar transaction needs a fixed source account and sequence number that can't be known before a wallet is chosen; any SEP-7-compatible wallet (Lobstr, Vibrant, Beans, xBull) builds its own transaction from the request.

Cashing out to a bank account is a real SEP-10 (auth) + SEP-24 (interactive withdrawal) integration against Stellar's own reference anchor (`testanchor.stellar.org`) — see [Fiat off-ramp](#fiat-off-ramp) below.

## Tech stack

- **NestJS 10** / TypeScript, `ts-node` (no build step in dev — there is no hot reload either; restart the process after editing anything under `src/`)
- **PostgreSQL**, raw `pg` pool — no ORM. Migrations are plain, ordered SQL files in `db/migrations/`
- **Zod** for request validation at every controller boundary
- **`@stellar/stellar-sdk`** for building/reading transactions server-side
- **Rust reconciler** (`reconciler/`), a separate binary using `sqlx` against the same Postgres database
- Static frontend pages served directly from `public/` via `readFileSync` (no templating engine, no bundler)

## Prerequisites

- Node.js 20+
- PostgreSQL 15+, running locally
- Rust (stable) — only needed to run the reconciler
- [Freighter](https://www.freighter.app/) browser extension, set to Testnet, for exercising checkout yourself

## Setup

```bash
npm install
```

Generate a real secret and create `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | e.g. `postgres://you@localhost:5432/konfirm_dev` |
| `JWT_SECRET` | Recommended | Falls back to an insecure dev default with a console warning if unset — fine for localhost, never beyond it |
| `PORT` | No | Defaults to `3001` |
| `SENTRY_DSN` | No | Enables error tracking (see Logging & error tracking below); a no-op without it |
| `NODE_ENV` | No | Set to `production` for real JSON log lines instead of the pretty dev formatter |

Create the database and apply migrations:

```bash
createdb konfirm_dev
npm run migrate:up
```

Run the API:

```bash
npm start
```

Run the reconciler (separate process, watches a specific merchant address):

```bash
cd reconciler
DATABASE_URL=postgres://you@localhost:5432/konfirm_dev \
  cargo run -- watch <merchant_stellar_address> <max_polls> <interval_secs>
```

## Reconciler CLI

| Command | Usage | Purpose |
|---|---|---|
| `seed-merchant` | `seed-merchant <stellar_address> <email> [name]` | Create/update a merchant row directly (bypasses signup — useful for scripted setup) |
| `watch` | `watch <merchant_address> [max_polls=20] [interval_secs=3]` | Poll Horizon for new payments to this address and record confirmed ones |
| `set-cursor` | `set-cursor <value\|'now'>` | Manually reset the Horizon paging cursor — a deliberate recovery/replay escape hatch, not a routine command |

`watch` exits after its first match by default — for a live session it needs to be wrapped in a loop (`while true; do cargo run -- watch ...; done`) so it keeps watching after each match.

## API reference

All endpoints are JSON unless noted. Routes marked 🔒 require a valid `konfirm_session` cookie (see [Auth](#auth)).

### Auth

| Method | Path | Body | Notes |
|---|---|---|---|
| `POST` | `/auth/signup` | `email, password, name, stellar_base_address` | Creates the merchant, logs them in immediately |
| `POST` | `/auth/login` | `email, password` | Same error for wrong email or wrong password — no account enumeration |
| `POST` | `/auth/logout` | — | Clears the session cookie |
| `GET` | `/auth/me` 🔒 | — | Current merchant's claims |

### Links

| Method | Path | Body | Notes |
|---|---|---|---|
| `POST` | `/links` 🔒 | `amount_usdc, currency?, description?, reusable?` | `merchant_id` is never accepted from the client — always derived from the session |
| `GET` | `/links/:id/public` | — | Narrow projection safe for a checkout page: amount, currency, description, merchant name, merchant's Stellar address |
| `POST` | `/links/:linkId/sessions` | `muxed_id` | Reserves a session ID against a link; 409 on collision (client retries with a new one) |

### Payments

| Method | Path | Query | Notes |
|---|---|---|---|
| `GET` | `/payments/prepare-tx` | `linkId, muxed_id, payer` | Builds an unsigned Freighter transaction; runs compliance screening first; bundles a `ChangeTrust` op automatically if the payer has no USDC trustline yet |
| `GET` | `/payments/pay-uri` | `linkId, muxed_id` | Returns a `web+stellar:pay` SEP-7 URI for QR/mobile-wallet checkout — no payer address needed or knowable at this point |
| `GET` | `/payments/by-merchant/:stellarAddress` | — | Confirmed payments for this address, newest first |
| `GET` | `/payments/pending-by-merchant/:stellarAddress` | — | Whether a session was reserved but hasn't landed yet (drives the "waiting" UI state) |

### Withdrawals (fiat off-ramp)

| Method | Path | Body | Notes |
|---|---|---|---|
| `GET` | `/withdrawals/challenge` 🔒 | — | Proxies a SEP-10 challenge from the anchor for the merchant's own address |
| `POST` | `/withdrawals/token` 🔒 | `transaction` (merchant-signed challenge) | Exchanges the signed challenge for an anchor session JWT |
| `POST` | `/withdrawals/start` 🔒 | `currency, token` | Opens a SEP-24 interactive session; returns the anchor's hosted URL |
| `GET` | `/withdrawals/status` 🔒 | `token, id` | Polls the anchor's transaction status |
| `POST` | `/withdrawals/prepare-payment` 🔒 | `currency, token, id` | Once the anchor is ready (`pending_user_transfer_start`), builds the on-chain payment to the anchor's account for the merchant to sign |

### Pages

`GET /login`, `/signup`, `/new`, `/pay/:linkId`, `/activity`, `/cashout` — static HTML served fresh from disk on every request (`Cache-Control: no-store`, ETags disabled), so edits under `public/` take effect on the next request without a server restart.

## Auth

Sessions are an httpOnly JWT cookie (`konfirm_session`, 30-day expiry, `SameSite=Lax`). Passwords are bcrypt-hashed. `AuthGuard` attaches `req.merchant` (id, email, name, `stellar_base_address`) to any route behind it — controllers derive identity from this, never from a client-supplied field.

## Project structure

```
src/
  auth/         signup, login, JWT session guard
  links/        payment link creation + public projection
  sessions/     muxed-ID reservation against a link
  payments/     prepare-tx (Freighter), pay-uri (SEP-7), compliance check, by-merchant queries
  withdrawals/  SEP-10/SEP-24 fiat off-ramp
  pages/        serves the static frontend
  common/       shared asset resolution (XLM/USDC)
  db/           Postgres pool
reconciler/     Rust binary — watches Horizon, writes confirmed payments
db/migrations/  ordered .up.sql/.down.sql pairs, applied by db/migrate.ts
db/migrate.ts   the migration runner itself — no framework, tracks applied migrations in Postgres
public/         frontend pages (mirrored in konfirm-frontend)
scripts/testnet-harness/  standalone Node scripts for exercising payments outside the browser
```

## Logging & error tracking

Structured JSON logs via `nestjs-pino` (pretty-printed in dev, real newline-delimited JSON in
production) — every request gets an id, correlating its log lines. Two things worth knowing:

- **Cookies and auth headers are redacted at the logger level** (`req.headers.cookie`,
  `req.headers.authorization`, `res.headers["set-cookie"]`) — verified by inspecting real log output,
  not just trusting the config. Structured logging that leaked the session JWT would be a net loss.
- **High-frequency polling routes are excluded from request/response logging**
  (`/payments/by-merchant`, `/payments/pending-by-merchant`, `/withdrawals/status`,
  `/deposits/status`) — the activity/checkout/cash-out pages hit these every 2–3 seconds while open,
  and logging every poll would drown out everything else within minutes.

A global exception filter (`src/observability/all-exceptions.filter.ts`) passes through every
`HttpException` unchanged (a 401 or a 409 is expected application flow, not an incident) and logs
anything else — a genuinely unexpected failure — with full detail (stack trace, the real upstream
error body) while the client only ever sees a generic `{"statusCode":500,"message":"internal server
error"}`. Verified for real by forcing an actual unhandled Horizon SDK error and confirming both the
rich server-side log and the safe client response.

Error tracking is `@sentry/node`, entirely opt-in via `SENTRY_DSN` — this pilot has never had a Sentry
project, so unlike everything else in this README, that half can't be proven against a real dashboard.
What's real: the integration itself, and that it's already wired into the exception filter above, so
setting one env var in production turns it on with no code change. Without a DSN it logs a startup
warning and is a documented no-op, not a silent gap.

## Testing

```bash
createdb konfirm_test
DATABASE_URL=postgres:///konfirm_test npm run migrate:up
npm test
```

Real Postgres, real bcrypt hashing, real Horizon calls — no mocks standing in for the things that
actually need to be correct. Three layers:

- **Unit** (`src/common/asset.spec.ts`) — pure logic, no I/O.
- **Integration** (`src/auth/auth.service.spec.ts`) — hits the real `konfirm_test` database (set via
  `test/env.ts`, never `konfirm_dev`) for signup/login/duplicate-email/no-account-enumeration checks.
- **Critical-path E2E** (`test/critical-path.e2e-spec.ts`) — boots the actual Nest app and drives it
  through signup → create link (verifying a client-supplied `merchant_id` is ignored) → reserve a
  session → prepare a transaction, then **decodes the returned XDR for real** and asserts on its
  destination, operation, and memo — exactly the kind of check that would have caught the
  muxed-address-vs-memo routing bug earlier in this project's life automatically, rather than needing
  a human to notice a wallet crash days later.

What this suite deliberately does **not** cover: actually signing and submitting a transaction (needs
a real wallet holding a private key — a browser-and-a-human problem, not a CI problem) and the
SEP-10/24 anchor's interactive popup (same reason). Those stay manually tested.

## Migrations

```bash
npm run migrate:up            # applies every pending .up.sql, in order
npm run migrate:down          # reverts the most recently applied migration
npm run migrate:down -- 3     # reverts the last 3
```

Each migration is a `NNN_name.up.sql` / `NNN_name.down.sql` pair — `db/migrate.ts` tracks what's been
applied in a `schema_migrations` table, so `up` only ever runs what's actually pending (safe to run
repeatedly) and `down` can genuinely undo something, not just re-run `CREATE TABLE IF NOT EXISTS` and
hope. The migration's SQL and its tracking-table record land in the same transaction, so a failure
can't leave the two out of sync.

Verified for real: applied all 5 from empty, reverted one at a time down to nothing (confirming each
table — and the `claim_link_seq` function — actually disappeared), then reapplied cleanly. This isn't
theoretical; every step above was run against a live scratch database, not inferred from reading the
script.

## Backups

```bash
db/scripts/backup.sh konfirm_dev              # dumps to db/backups/, prunes to the last 14
db/scripts/restore.sh <dump_file> <target_db>  # restores; refuses to clobber a non-empty DB without FORCE=1
```

A daily backup runs via cron (`crontab -l` to see it) at 03:00. Both scripts have been run for real —
restoring into a scratch database and diffing every table's row count against the original, not just
checking that `pg_dump` exited zero.

**This is not a real backup strategy yet** — it's a local file on the same disk as the database it's
backing up. A drive failure takes out both. Before this matters for real: ship dumps to a second
location (S3, another machine) as part of the same script.

## Rate limiting

`@nestjs/throttler`, global default of 60 req/min per IP per route. Tighter limits where it actually
matters: `/auth/login` and `/auth/signup` at 10/min (brute-force/signup-spam resistance), and anything
that calls an external service — `/payments/prepare-tx` (shells out to the `stellar` CLI *and* calls
Horizon), the whole `/withdrawals` and `/deposits` controllers (call the anchor) — at 20/min, since
those are slower and more expensive to abuse than a plain DB read. Status-polling endpoints
(`/withdrawals/status`, `/deposits/status`) get their own 60/min headroom since the frontend polls them
every 3 seconds for the duration of a cash-out or deposit, which would otherwise sit right at a tighter
limit's boundary.

## Timeouts & retries

Every external call (Horizon, the `stellar` CLI compliance check, the anchor) has a real timeout —
none of them could hang a request indefinitely before this. Retries are deliberately asymmetric, not
uniform, based on what's actually safe to repeat:

| Call | Retry? | Why |
|---|---|---|
| `horizon.loadAccount` (reads) | Yes, 2x | A read has no side effect if repeated |
| Anchor `GET` calls (challenge, status) | Yes | Same — idempotent reads |
| Anchor `POST /auth` (token exchange) | Once | Re-submitting the same signed challenge is safe |
| Anchor `POST .../interactive` (start withdraw/deposit) | No | Creates a new transaction on the anchor's side every success — a lost response retried blindly risks an orphaned duplicate, not a fixed request |
| Compliance CLI shell-out | Once | Already fails open on any failure; one retry catches a single blip before falling through |

`fetchWithRetry` (`src/common/retry.ts`) only retries a transport-level failure or a 5xx — a 4xx means
the same thing on every attempt, so it's returned immediately rather than wasting three attempts on a
request that was never going to succeed. Covered by unit tests, including the specific case of *not*
retrying a 400.

The Rust reconciler's `reqwest::Client` had no timeout at all by default; it now has one, plus its own
retry-with-backoff on Horizon polling, on top of the existing shell-level `while true` restart loop
documented above.

## Known limitations

- **Testnet only.** Mainnet needs a funded production USDC issuer, `JWT_SECRET` in a real secrets manager, and HTTPS in front of the session cookie.
- **XLM and USDC only.** `EURC` is accepted by validation but not implemented in `prepareTx` or `buildPayUri`.
- **Compliance screening only runs on the Freighter path.** The QR/SEP-7 path has no payer address to check before the wallet submits — screening there is necessarily after the fact.
- **Compliance check shells out to the `stellar` CLI** rather than calling Soroban RPC directly — reasonable for a pilot, a real follow-up before scale.
- **The reconciler watches one merchant address per process.** Fine for a pilot; a real deployment needs either one process per merchant or a multi-account watch loop.
- Fails open, loudly, if the compliance contract is unreachable (logged, never silent) — a deliberate choice, not an oversight.

## License

No license file yet — private project, all rights reserved by default.
