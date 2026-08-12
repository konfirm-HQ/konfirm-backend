# x402 harness

Verifies Konfirm's x402 facilitator (`src/x402/`) end-to-end against the
**official, unmodified** x402 client and resource-server packages —
proving real interop, not just that Konfirm's own code talks to itself.
Mirrors `scripts/testnet-harness/`'s "proof before polish" pattern, and
follows skills.stellar.org's `agentic-payments` skill examples verbatim
(only the facilitator URL is Konfirm's own instead of OZ Channels).

## Run it

```bash
npm install
node setup.js
```

This generates a fresh recipient (`payTo`) and payer keypair, funds both
with testnet XLM, and adds a USDC trustline to both — then writes `.env`.

One step is genuinely manual — Circle's testnet USDC faucet is a web form
with a Captcha, no API (confirmed in the skill doc, not a gap in this
harness): open <https://faucet.circle.com>, select **Stellar testnet**,
and paste the payer address `setup.js` prints.

Once the payer holds testnet USDC:

```bash
node resource-server.js   # terminal 1 — a standard @x402/express server
node agent-client.js      # terminal 2 — pays for GET /paid-resource
```

A successful run prints the settlement response, including a real tx hash
checkable on `stellar.expert/explorer/testnet`.

## What this proves

- `resource-server.js` is the **unmodified** `@x402/express` +
  `HTTPFacilitatorClient` + `ExactStellarScheme` (server variant) —
  configured to call Konfirm's `/x402/verify` and `/x402/settle` instead of
  OZ Channels. If the official resource-server package can drive a
  real payment through Konfirm's facilitator, the facilitator is
  spec-compliant, not just internally self-consistent.
- `agent-client.js` is the **unmodified** `@x402/fetch` + `@x402/stellar`
  client — the same code any real AI agent would run.
- Konfirm's differentiated layer (the compliance check) can be exercised by
  blocking the payer address via the admin API
  (`POST /admin/compliance/blocked-addresses`) before running
  `agent-client.js` — the resource server should receive a 402 with
  `compliance_blocked` as the reason, not a silent failure.
