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

Create the database and apply migrations, in order:

```bash
createdb konfirm_dev
for f in db/migrations/*.sql; do psql konfirm_dev -f "$f"; done
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
db/migrations/  ordered SQL, no migration framework
public/         frontend pages (mirrored in konfirm-frontend)
scripts/testnet-harness/  standalone Node scripts for exercising payments outside the browser
```

## Known limitations

- **Testnet only.** Mainnet needs a funded production USDC issuer, `JWT_SECRET` in a real secrets manager, and HTTPS in front of the session cookie.
- **XLM and USDC only.** `EURC` is accepted by validation but not implemented in `prepareTx` or `buildPayUri`.
- **Compliance screening only runs on the Freighter path.** The QR/SEP-7 path has no payer address to check before the wallet submits — screening there is necessarily after the fact.
- **Compliance check shells out to the `stellar` CLI** rather than calling Soroban RPC directly — reasonable for a pilot, a real follow-up before scale.
- **The reconciler watches one merchant address per process.** Fine for a pilot; a real deployment needs either one process per merchant or a multi-account watch loop.
- Fails open, loudly, if the compliance contract is unreachable (logged, never silent) — a deliberate choice, not an oversight.

## License

No license file yet — private project, all rights reserved by default.
