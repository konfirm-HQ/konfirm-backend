import { BadRequestException, Injectable } from '@nestjs/common';
import { BASE_FEE, Horizon, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { resolveAsset } from '../common/asset';
import { fetchWithRetry, withRetry } from '../common/retry';

const FETCH_TIMEOUT_MS = 10_000;

// Same reference anchor as withdrawals.service.ts. Deposits are the mirror
// direction: get test USDC into a wallet, for exercising checkout without
// an external faucet. Not gated behind AuthGuard — there's no Konfirm
// account involved on either side, just an address willing to receive test
// money.
//
// The SEP-10 login is signed by Freighter, not by scanning a QR with the
// destination wallet — a QR-based `tx`+callback signing request (the SEP-7
// equivalent for a wallet with no browser extension) turned out not to be
// reliably supported: Lobstr rejected a SEP-10 challenge presented that way
// as "invalid or unsupported data." Freighter signing anchor challenges is
// already proven throughout this project (cashout.html), so the funds land
// in whatever account Freighter is connected to first, then get forwarded
// on-chain to the actual destination wallet with one ordinary payment.
const WEB_AUTH_ENDPOINT = 'https://testanchor.stellar.org/auth';
const TRANSFER_SERVER = 'https://testanchor.stellar.org/sep24';
const HORIZON_URL = 'https://horizon-testnet.stellar.org';

@Injectable()
export class DepositsService {
  private horizon = new Horizon.Server(HORIZON_URL);

  // GET, no side effects — safe to retry freely. fetchWithRetry only
  // retries transport failures and 5xx; a 4xx means the same thing on
  // every attempt, so it's returned immediately instead of wasting time.
  async getChallenge(account: string) {
    const res = await fetchWithRetry(`${WEB_AUTH_ENDPOINT}?account=${encodeURIComponent(account)}`, {}, { timeoutMs: FETCH_TIMEOUT_MS });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new BadRequestException(body.error || 'could not reach the test-funds partner');
    return body;
  }

  // One retry — resubmitting the same already-signed challenge is safe.
  async exchangeToken(signedTransaction: string) {
    const res = await fetchWithRetry(
      WEB_AUTH_ENDPOINT,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction: signedTransaction }),
      },
      { retries: 1, timeoutMs: FETCH_TIMEOUT_MS },
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new BadRequestException(body.error || 'the test-funds partner rejected that signature');
    return body;
  }

  // No retry, same reasoning as withdrawals.service.ts's startWithdrawal:
  // this creates a new transaction on the anchor's side every time it
  // succeeds, so a lost response can't be safely retried without risking a
  // duplicate.
  async startDeposit(token: string, currency: string, account: string) {
    const assetCode = currency === 'XLM' ? 'native' : currency;
    const res = await fetch(`${TRANSFER_SERVER}/transactions/deposit/interactive`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ asset_code: assetCode, account }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new BadRequestException(body.error || 'could not start a deposit');
    return body;
  }

  // A read, polled repeatedly anyway by the caller — safe to retry.
  async getStatus(token: string, id: string) {
    const res = await fetchWithRetry(
      `${TRANSFER_SERVER}/transaction?id=${encodeURIComponent(id)}`,
      { headers: { Authorization: `Bearer ${token}` } },
      { timeoutMs: FETCH_TIMEOUT_MS },
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new BadRequestException(body.error || 'could not check deposit status');
    return body.transaction;
  }

  // The second on-chain leg: once the anchor has deposited test funds into
  // Freighter's own account, forward them to wherever they're actually
  // needed (e.g. a mobile wallet being used for a separate checkout test).
  // Same trustline-bundling logic as payments.service.ts's prepareTx, since
  // the destination may never have held this asset either.
  async prepareTransferPayment(from: string, to: string, currency: string, amount: string) {
    const asset = resolveAsset(currency);
    // Retried: this is Freighter's own account, expected to exist — a
    // failure here is far more likely a network blip than a real 404.
    const fromAccount = await withRetry(() => this.horizon.loadAccount(from), { retries: 2, timeoutMs: 8_000 });

    const builder = new TransactionBuilder(fromAccount, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    });

    if (!asset.isNative()) {
      // Not retried, deliberately: this is a user-typed destination address
      // that may simply not exist — retrying a genuine "not found" three
      // times before reporting it would just make a real mistake feel like
      // a hang.
      let toBalances: Array<{ asset_code?: string; asset_issuer?: string }>;
      try {
        const toAccount = await this.horizon.loadAccount(to);
        toBalances = toAccount.balances as Array<{ asset_code?: string; asset_issuer?: string }>;
      } catch {
        throw new BadRequestException('the destination account was not found on the network');
      }
      const hasTrustline = toBalances.some(
        (b) => b.asset_code === asset.getCode() && b.asset_issuer === asset.getIssuer(),
      );
      if (!hasTrustline) {
        throw new BadRequestException('the destination wallet has no trustline for this asset yet');
      }
    }

    const tx = builder
      .addOperation(Operation.payment({ destination: to, asset, amount }))
      .setTimeout(60)
      .build();

    return { xdr: tx.toXDR(), network_passphrase: Networks.TESTNET };
  }
}
