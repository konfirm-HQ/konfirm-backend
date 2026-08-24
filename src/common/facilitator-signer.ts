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
