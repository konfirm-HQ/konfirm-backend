import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createEd25519Signer, STELLAR_TESTNET_CAIP2 } from '@x402/stellar';
import type { Ed25519Signer } from '@x402/stellar';

const execFileAsync = promisify(execFile);

// Same identity resolution as payments.service.ts/compliance.rs/
// onchain-compliance.ts: a raw secret key in production
// (STELLAR_DEPLOYER_SECRET_KEY — no interactive `stellar keys add` is
// possible in a container), or the locally pre-registered 'deployer' CLI
// identity in dev. Extracted out of x402.service.ts (where this lived
// standalone until the channel module needed the same signer for its own
// Soroban submissions) so both X402Service and ChannelService construct
// the exact same signer once, rather than each resolving the secret key
// independently.
async function resolveDeployerSecretKey(): Promise<string> {
  const fromEnv = process.env.STELLAR_DEPLOYER_SECRET_KEY;
  if (fromEnv) return fromEnv;
  const { stdout } = await execFileAsync('stellar', ['keys', 'secret', 'deployer']);
  return stdout.trim();
}

let signerPromise: Promise<Ed25519Signer> | null = null;

export function getFacilitatorSigner(): Promise<Ed25519Signer> {
  if (!signerPromise) {
    signerPromise = resolveDeployerSecretKey().then((secretKey) => createEd25519Signer(secretKey, STELLAR_TESTNET_CAIP2));
  }
  return signerPromise;
}

// Stellar allows exactly one in-flight transaction per source account
// sequence number. Every facilitator-submitted transaction — x402 single-
// shot settlement, channel open/close, and the keeper's checkpoint/
// finalize_close — signs with this same signer/account, so two of them
// racing (e.g. two concurrent /x402/settle calls, or a settle landing
// mid-sweep) independently fetch the same "current" sequence number and
// only one submission survives; the other fails with a bad-sequence
// error. A simple promise-chained queue serializes just the
// fetch-sequence-through-submit critical section across every call site
// sharing this signer, without needing a distributed lock — there is only
// ever one process holding this signer's key. Chained with `.then(fn, fn)`
// rather than `.finally()` so the queue always advances to the next
// waiter regardless of whether the previous submission succeeded or
// threw — a `.finally()` here would still surface the rejection.
let submissionQueue: Promise<unknown> = Promise.resolve();

export function withFacilitatorSubmissionLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = submissionQueue.then(fn, fn);
  submissionQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
