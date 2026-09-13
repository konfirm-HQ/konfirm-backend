/// <reference path="../common/stellar-sdk-contract.d.ts" />
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from '@stellar/stellar-sdk';
import { Client } from '@stellar/stellar-sdk/contract';
import type { AssembledTransaction, MethodOptions } from '@stellar/stellar-sdk/contract';
import { pool } from '../db/pool';
import { withRetry } from '../common/retry';
import { getFacilitatorSigner, withFacilitatorSubmissionLock } from '../common/facilitator-signer';
import { FacilitatorSpendGuardService, FacilitatorHalted, FacilitatorSpendCapExceeded } from './facilitator-spend-guard.service';

const RPC_URL = 'https://soroban-testnet.stellar.org';
// USDC's SAC (SEP-41 token contract) on testnet -- same address
// admin-treasury.service.ts and @x402/stellar's own ExactStellarScheme use.
const USDC_SAC_ID = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
// The fixed, fund-custodying treasury instance -- same address
// admin-treasury.service.ts reads, from konfirm-contracts/README.md's
// "Deployed addresses (Testnet)" table.
const TREASURY_CONTRACT_ID = 'CD77HPVBGIRYQGXC4JVCEO35X6FKFFJ2C4EZ63EQCOXGR6OL4TVEPZ2T';
const STROOPS_PER_UNIT = 10_000_000;
// Arbitrary but stable pg_advisory_lock key -- namespaced away from
// ChannelKeeperService's own KEEPER_LOCK_KEY (402_001).
const SWEEP_LOCK_KEY = 402_002;

interface SacTokenContract {
  balance(args: { id: string }, options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
}

let clientPromise: Promise<Client & SacTokenContract> | null = null;
function getUsdcClient(publicKey: string): Promise<Client & SacTokenContract> {
  if (!clientPromise) {
    clientPromise = Client.from<SacTokenContract>({
      contractId: USDC_SAC_ID,
      networkPassphrase: Networks.TESTNET,
      rpcUrl: RPC_URL,
      publicKey,
    });
  }
  return clientPromise;
}

/**
 * Sweeps the facilitator's own accumulated USDC balance above a configured
 * operating minimum into the (multisig-gated) treasury contract. This is
 * the one operation in the facilitator's whole call surface that actually
 * moves the facilitator's *own* money -- x402 settle and channel
 * open/checkpoint/close all relay value between a payer and payee whose
 * destinations are fixed by their own independently-signed inputs, so a
 * compromised-but-still-legitimate facilitator process can't redirect
 * those. It CAN redirect this sweep, which is exactly why
 * FacilitatorSpendGuardService is wired in here and nowhere else.
 *
 * In-process @Cron(), same reasoning as ChannelKeeperService/
 * ReferralRewardsService: shares the same Postgres pool and Soroban signer
 * the api service already owns, and a standalone service would just
 * reproduce the backup-cron shared-railway.json class of bug this project
 * already hit once, for no benefit here.
 */
@Injectable()
export class FacilitatorSweepService {
  private readonly logger = new Logger(FacilitatorSweepService.name);

  constructor(private readonly spendGuard: FacilitatorSpendGuardService) {}

  @Cron('*/30 * * * *')
  async sweep(): Promise<void> {
    // Unset means "not configured", not "sweep everything" -- leaving an
    // in-flight facilitator's hot-wallet balance undefined is the wrong
    // failure mode (it still needs USDC/XLM for the next settlement);
    // skipping the sweep is the safe default until an operator explicitly
    // sets a minimum to preserve.
    const minUsdcRaw = process.env.FACILITATOR_SWEEP_MIN_USDC_BALANCE;
    if (minUsdcRaw === undefined) {
      this.logger.debug('FACILITATOR_SWEEP_MIN_USDC_BALANCE not set -- skipping sweep');
      return;
    }

    const client = await pool.connect();
    try {
      const { rows } = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [
        SWEEP_LOCK_KEY,
      ]);
      if (!rows[0].locked) {
        // Another sweep -- or another api replica -- is already running.
        return;
      }
      try {
        await this.doSweep(Number(minUsdcRaw));
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [SWEEP_LOCK_KEY]);
      }
    } catch (err) {
      this.logger.error(`sweep failed: ${err}`);
    } finally {
      client.release();
    }
  }

  private async doSweep(minUsdc: number): Promise<void> {
    const signer = await getFacilitatorSigner();

    let balanceStroops: bigint;
    try {
      const usdc = await getUsdcClient(signer.address);
      const tx = await withRetry(() => usdc.balance({ id: signer.address }), { retries: 1, timeoutMs: 8_000 });
      balanceStroops = tx.result;
    } catch (err) {
      clientPromise = null;
      this.logger.error(`could not read facilitator USDC balance: ${err}`);
      return;
    }

    const minStroops = BigInt(Math.round(minUsdc * STROOPS_PER_UNIT));
    const sweepStroops = balanceStroops - minStroops;
    if (sweepStroops <= 0n) {
      return;
    }
    const sweepUsdc = Number(sweepStroops) / STROOPS_PER_UNIT;

    // Recorded (and, on a cap breach, halted) BEFORE submission -- see
    // FacilitatorSpendGuardService's own doc comment for why this fails
    // closed rather than reconciling after the fact.
    try {
      await this.spendGuard.checkAndRecordSpend(sweepUsdc, 'sweep', TREASURY_CONTRACT_ID);
    } catch (err) {
      if (err instanceof FacilitatorHalted || err instanceof FacilitatorSpendCapExceeded) {
        this.logger.warn(`sweep blocked: ${err.message}`);
        return;
      }
      throw err;
    }

    const result = await this.submitTransfer(signer.address, sweepStroops);
    if (!result.success) {
      this.logger.error(`sweep transfer failed: ${result.errorReason}`);
      return;
    }
    this.logger.log(
      `swept ${sweepUsdc.toFixed(7)} USDC from ${signer.address} to treasury ${TREASURY_CONTRACT_ID}: ${result.transaction}`,
    );
  }

  // Mirrors ChannelService's private submitFacilitatorCall (same
  // simulate-then-prepare-with-real-sorobanData-then-sign-then-submit
  // shape, same withFacilitatorSubmissionLock use to avoid a sequence-
  // number race against any other facilitator submission in flight) --
  // duplicated rather than shared because it targets a different contract
  // (the USDC SAC's own `transfer`, not the channel contract) and this
  // project already duplicates this exact shape once (channel.service.ts)
  // rather than building a generic abstraction for two call sites.
  private async submitTransfer(
    fromAddress: string,
    amountStroops: bigint,
  ): Promise<{ success: boolean; transaction?: string; errorReason?: string }> {
    const server = new rpc.Server(RPC_URL);
    const signer = await getFacilitatorSigner();
    const contract = new Contract(USDC_SAC_ID);
    const args = [
      new Address(fromAddress).toScVal(),
      new Address(TREASURY_CONTRACT_ID).toScVal(),
      nativeToScVal(amountStroops, { type: 'i128' }),
    ];

    return withFacilitatorSubmissionLock(async () => {
      let sentHash: string;
      try {
        const account = await server.getAccount(signer.address);
        // Simulated off a disposable clone, not `account` itself --
        // TransactionBuilder.build() mutates its source Account's sequence
        // number in place, and this simulation-only transaction is never
        // submitted. See channel.service.ts's submitFacilitatorCall for the
        // real bug this avoids (a live checkpointChannel() call failing
        // with a sequence-number-off-by-one before this pattern existed).
        const simAccount = new Account(account.accountId(), account.sequenceNumber());
        const simTx = new TransactionBuilder(simAccount, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
          .setTimeout(60)
          .addOperation(contract.call('transfer', ...args))
          .build();

        const sim = await server.simulateTransaction(simTx);
        if (!rpc.Api.isSimulationSuccess(sim)) {
          return { success: false, errorReason: 'sweep_simulation_failed' };
        }
        const sorobanData = sim.transactionData.build();
        const prepared = new TransactionBuilder(account, {
          fee: BASE_FEE,
          networkPassphrase: Networks.TESTNET,
          sorobanData,
        })
          .setTimeout(60)
          .addOperation(contract.call('transfer', ...args))
          .build();

        const { signedTxXdr, error: signError } = await signer.signTransaction(prepared.toXDR(), {
          networkPassphrase: Networks.TESTNET,
        });
        if (signError || !signedTxXdr) {
          return { success: false, errorReason: 'sweep_signing_failed' };
        }

        const txToSubmit = TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET);
        const sendResult = await server.sendTransaction(txToSubmit);
        if (sendResult.status !== 'PENDING') {
          return { success: false, errorReason: 'sweep_submission_failed' };
        }
        sentHash = sendResult.hash;
      } catch (err) {
        this.logger.error(`sweep transfer failed: ${err}`);
        return { success: false, errorReason: 'sweep_failed' };
      }

      return this.pollForTransaction(server, sentHash);
    });
  }

  private async pollForTransaction(
    server: rpc.Server,
    txHash: string,
    maxAttempts = 15,
    delayMs = 1000,
  ): Promise<{ success: boolean; transaction: string; errorReason?: string }> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const result = await server.getTransaction(txHash);
        if (result.status === 'SUCCESS') {
          return { success: true, transaction: txHash };
        }
        if (result.status === 'FAILED') {
          return { success: false, transaction: txHash, errorReason: 'transaction_failed' };
        }
      } catch {
        // NOT_FOUND while still pending -- expected, keep polling.
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return { success: false, transaction: txHash, errorReason: 'transaction_timeout' };
  }
}
