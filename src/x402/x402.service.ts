/// <reference path="./x402-stellar-facilitator.d.ts" />
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createEd25519Signer, USDC_TESTNET_ADDRESS, STELLAR_TESTNET_CAIP2, DEFAULT_TESTNET_RPC_URL } from '@x402/stellar';
import { ExactStellarScheme } from '@x402/stellar/exact/facilitator';
import type { PaymentPayload, PaymentRequirements, SettleResponse, SupportedResponse, VerifyResponse } from './x402.types';
import { pool } from '../db/pool';
import { isAllowedOnChain } from '../common/onchain-compliance';

const execFileAsync = promisify(execFile);

@Injectable()
export class X402Service implements OnModuleInit {
  private readonly logger = new Logger(X402Service.name);
  private scheme!: ExactStellarScheme;

  // Constructed once at startup, not per-request — ExactStellarScheme signs
  // in-process with real key material (unlike the CLI-shelled compliance
  // check below), so the signer only needs to be resolved once.
  async onModuleInit() {
    const secretKey = await this.resolveDeployerSecretKey();
    const signer = createEd25519Signer(secretKey, STELLAR_TESTNET_CAIP2);
    this.scheme = new ExactStellarScheme([signer], {
      rpcConfig: { url: DEFAULT_TESTNET_RPC_URL },
    });
    this.logger.log(`x402 facilitator ready, signing address ${signer.address}`);
  }

  getSupported(): SupportedResponse {
    return {
      kinds: [
        {
          x402Version: 2,
          scheme: 'exact',
          network: STELLAR_TESTNET_CAIP2,
          extra: this.scheme.getExtra(STELLAR_TESTNET_CAIP2),
        },
      ],
      extensions: [],
    };
  }

  // Same identity resolution as payments.service.ts/compliance.rs: a raw
  // secret key in production (STELLAR_DEPLOYER_SECRET_KEY, set as a
  // deploy-time env var — no interactive `stellar keys add` is possible in
  // a container), or the locally pre-registered 'deployer' identity in dev.
  // Unlike the CLI-shelled compliance check, createEd25519Signer needs real
  // key material up front rather than an identity name it can resolve
  // itself, so the local-dev fallback shells out once to `stellar keys
  // secret` to get the actual secret.
  private async resolveDeployerSecretKey(): Promise<string> {
    const fromEnv = process.env.STELLAR_DEPLOYER_SECRET_KEY;
    if (fromEnv) return fromEnv;
    const { stdout } = await execFileAsync('stellar', ['keys', 'secret', 'deployer']);
    return stdout.trim();
  }

  // Same local-blocklist-then-on-chain-contract pattern as
  // payments.service.ts's isPayerAllowed — now protecting a third payment
  // path (Freighter checkout, the reconciler's after-the-fact SEP-7
  // screening, and this inline x402 verification). The on-chain half is
  // now a shared module (src/common/onchain-compliance.ts) rather than
  // duplicated CLI-shell code — both call sites moved off the `stellar`
  // CLI to a direct Soroban RPC call together.
  private async isPayerAllowed(address: string): Promise<boolean> {
    const { rows } = await pool.query('SELECT 1 FROM blocked_addresses WHERE stellar_address = $1', [address]);
    if (rows.length > 0) return false;
    return isAllowedOnChain(address);
  }

  // Deterministic per-signed-payload key: hashing the base64 transaction
  // blob (rather than hand-parsing the auth entry's nonce out of the XDR)
  // is enough to make a resubmitted identical payload a no-op at the
  // facilitator level — genuine replay protection is Soroban's own
  // auth-entry nonce on-chain; this is the secondary, belt-and-suspenders
  // layer, so it doesn't need to reimplement XDR parsing to do its job.
  private idempotencyKey(payer: string, payload: PaymentPayload): string {
    const raw = JSON.stringify(payload.payload);
    const hash = createHash('sha256').update(raw).digest('hex');
    return `${payer}:${hash}`;
  }

  private async recordAttempt(params: {
    payer: string;
    requirements: PaymentRequirements;
    status: 'settled' | 'failed' | 'held';
    txHash: string | null;
    idempotencyKey: string;
  }) {
    try {
      await pool.query(
        `INSERT INTO x402_settlements (payer_address, pay_to, asset_contract, amount, resource_url, status, tx_hash, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [
          params.payer,
          params.requirements.payTo,
          params.requirements.asset,
          params.requirements.amount,
          null,
          params.status,
          params.txHash,
          params.idempotencyKey,
        ],
      );
    } catch (err) {
      this.logger.error(`failed to record x402 settlement attempt: ${err}`);
    }
  }

  // Allowlist of supported SEP-41 SAC contract addresses. Configurable via
  // X402_ALLOWED_ASSETS (comma-separated list of contract addresses),
  // defaulting to USDC testnet address if unset or empty.
  private getAllowedAssets(): Set<string> {
    const raw = process.env.X402_ALLOWED_ASSETS;
    if (raw) {
      const addresses = raw
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean);
      if (addresses.length > 0) {
        return new Set(addresses);
      }
    }
    return new Set([USDC_TESTNET_ADDRESS]);
  }

  // Scope guard, checked before the package is ever called —
  // scheme, network, and asset allowlist.
  private outOfScopeReason(x402Version: number, requirements: PaymentRequirements): string | null {
    if (x402Version !== 2) return 'unsupported_x402_version';
    if (requirements.scheme !== 'exact') return 'unsupported_scheme';
    if (requirements.network !== STELLAR_TESTNET_CAIP2) return 'unsupported_network';
    if (!this.getAllowedAssets().has(requirements.asset)) return 'unsupported_asset';
    return null;
  }

  async verify(x402Version: number, payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse> {
    const scopeReason = this.outOfScopeReason(x402Version, requirements);
    if (scopeReason) return { isValid: false, invalidReason: scopeReason };

    const protocolResult = await this.scheme.verify(payload, requirements);
    if (!protocolResult.isValid) return protocolResult;

    // The package's own facilitator-safety checks (payer/tx source can't be
    // the facilitator itself, no sub-invocations, etc.) already ran inside
    // scheme.verify() above — this is Konfirm's own additional layer, run
    // only once the protocol-level check has already passed.
    const payer = protocolResult.payer;
    if (payer) {
      const allowed = await this.isPayerAllowed(payer);
      if (!allowed) {
        await this.recordAttempt({
          payer,
          requirements,
          status: 'held',
          txHash: null,
          idempotencyKey: this.idempotencyKey(payer, payload),
        });
        return { ...protocolResult, isValid: false, invalidReason: 'compliance_blocked' };
      }
    }
    return protocolResult;
  }

  // Never settles something unverified — verify() (protocol check +
  // compliance check together) runs first, and scheme.settle() is only
  // called if both pass.
  async settle(x402Version: number, payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
    const verifyResult = await this.verify(x402Version, payload, requirements);
    if (!verifyResult.isValid) {
      return {
        success: false,
        errorReason: verifyResult.invalidReason,
        payer: verifyResult.payer,
        transaction: '',
        network: requirements.network,
      };
    }

    try {
      const result = await this.scheme.settle(payload, requirements);
      const payer = result.payer ?? verifyResult.payer;
      if (payer) {
        await this.recordAttempt({
          payer,
          requirements,
          status: result.success ? 'settled' : 'failed',
          txHash: result.success ? result.transaction : null,
          idempotencyKey: this.idempotencyKey(payer, payload),
        });
      }
      return result;
    } catch (err) {
      this.logger.error(`x402 settlement failed: ${err}`);
      const payer = verifyResult.payer;
      if (payer) {
        await this.recordAttempt({
          payer,
          requirements,
          status: 'failed',
          txHash: null,
          idempotencyKey: this.idempotencyKey(payer, payload),
        });
      }
      return {
        success: false,
        errorReason: 'settlement_error',
        payer,
        transaction: '',
        network: requirements.network,
      };
    }
  }
}
