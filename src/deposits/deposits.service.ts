import { BadRequestException, Injectable } from '@nestjs/common';
import { BASE_FEE, Horizon, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { resolveAsset } from '../common/asset';

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

  async getChallenge(account: string) {
    const res = await fetch(`${WEB_AUTH_ENDPOINT}?account=${encodeURIComponent(account)}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new BadRequestException(body.error || 'could not reach the test-funds partner');
    return body;
  }

  async exchangeToken(signedTransaction: string) {
    const res = await fetch(WEB_AUTH_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction: signedTransaction }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new BadRequestException(body.error || 'the test-funds partner rejected that signature');
    return body;
  }

  async startDeposit(token: string, currency: string, account: string) {
    const assetCode = currency === 'XLM' ? 'native' : currency;
    const res = await fetch(`${TRANSFER_SERVER}/transactions/deposit/interactive`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ asset_code: assetCode, account }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new BadRequestException(body.error || 'could not start a deposit');
    return body;
  }

  async getStatus(token: string, id: string) {
    const res = await fetch(`${TRANSFER_SERVER}/transaction?id=${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
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
    const fromAccount = await this.horizon.loadAccount(from);

    const builder = new TransactionBuilder(fromAccount, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    });

    if (!asset.isNative()) {
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
