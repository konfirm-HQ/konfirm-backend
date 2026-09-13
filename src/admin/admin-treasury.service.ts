/// <reference path="../common/stellar-sdk-contract.d.ts" />
import { Injectable } from '@nestjs/common';
import { Client } from '@stellar/stellar-sdk/contract';
import type { AssembledTransaction, MethodOptions } from '@stellar/stellar-sdk/contract';
import { Networks } from '@stellar/stellar-sdk';
import { withRetry } from '../common/retry';

const RPC_URL = 'https://soroban-testnet.stellar.org';
// USDC's SAC (SEP-41 token contract) on testnet — same address
// @x402/stellar's own ExactStellarScheme uses (USDC_TESTNET_ADDRESS).
const USDC_SAC_ID = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
// From konfirm-contracts/README.md's "Deployed addresses (Testnet)" table.
const TREASURY_CONTRACT_ID = 'CD77HPVBGIRYQGXC4JVCEO35X6FKFFJ2C4EZ63EQCOXGR6OL4TVEPZ2T';
const TREASURY_SIGNERS = [
  'GAEMG5TVLEIQYCY3XB4EJT742DIE3FQO53RSESSYJQUZIWZOJQIZATJS',
  'GBRUR4UZHKPQ76S4S7X7INENL6QJ4UGNFIQ3F6VAYJQZRO3F4XBZAIND',
  'GCP57AJNZIVVTPPSD4MJ2SQDMTN4QEAUP64U2OZ4HXSAU4O4A6NOWY2Z',
];
// Same convenience simulation source as onchain-compliance.ts — a
// read-only `balance` call never signs or pays a fee, it just needs a
// real, funded source account for simulation context.
const SIMULATION_SOURCE = 'GAEMG5TVLEIQYCY3XB4EJT742DIE3FQO53RSESSYJQUZIWZOJQIZATJS';

interface SacTokenContract {
  balance(args: { id: string }, options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
}

let clientPromise: Promise<Client & SacTokenContract> | null = null;
function getUsdcClient(): Promise<Client & SacTokenContract> {
  if (!clientPromise) {
    clientPromise = Client.from<SacTokenContract>({
      contractId: USDC_SAC_ID,
      networkPassphrase: Networks.TESTNET,
      rpcUrl: RPC_URL,
      publicKey: SIMULATION_SOURCE,
    });
  }
  return clientPromise;
}

@Injectable()
export class AdminTreasuryService {
  async status() {
    let usdcBalance: string | null = null;
    let reachable = true;
    try {
      const tx = await withRetry(
        async () => {
          const client = await getUsdcClient();
          return client.balance({ id: TREASURY_CONTRACT_ID });
        },
        { retries: 1, timeoutMs: 8_000 },
      );
      usdcBalance = (Number(tx.result) / 10_000_000).toFixed(7);
    } catch (err) {
      reachable = false;
      clientPromise = null;
      // eslint-disable-next-line no-console
      console.warn('[admin] could not read treasury USDC balance', err);
    }

    return {
      contract_id: TREASURY_CONTRACT_ID,
      signers: TREASURY_SIGNERS,
      threshold: '2-of-3',
      usdc_balance: usdcBalance,
      reachable,
      // The treasury contract is deployed but nothing in the live checkout
      // or x402 path routes funds through it yet (tracked as an open
      // GitHub issue on konfirm-backend) — surfaced explicitly here rather
      // than implied by an empty balance, which would look like a bug.
      wired_into_checkout: false,
    };
  }
}
