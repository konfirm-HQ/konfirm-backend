import { Injectable, Logger } from '@nestjs/common';
import { Address, BASE_FEE, Networks, Transaction, TransactionBuilder, Operation, scValToNative, rpc } from '@stellar/stellar-sdk';
import { pool } from '../db/pool';
import { verifyClaimSignature } from '../common/channel-claim';
import { getFacilitatorSigner } from '../common/facilitator-signer';
import { isAllowedOnChain } from '../common/onchain-compliance';

export interface ClaimResult {
  accepted: boolean;
  reason?: string;
}

export interface OpenChannelResult {
  success: boolean;
  onchainChannelId?: string;
  transaction?: string;
  errorReason?: string;
}

const CHANNEL_CONTRACT_ID = 'CDS2Y4CQMQWFLCG5GHVKX7UIXHYPM6IJDJZTEXSASSHGHLESGLGLNPL6';
const RPC_URL = 'https://soroban-testnet.stellar.org';

@Injectable()
export class ChannelService {
  private readonly logger = new Logger(ChannelService.name);

  // The fast path: hit once per request instead of /x402/settle once a
  // channel is open. No RPC call anywhere in here — the whole point of
  // netting is that this costs a Postgres round-trip and a local ed25519
  // verification, not a Soroban simulation + submission. The channel's
  // actual on-chain checkpoint only happens later, via the keeper.
  async claim(params: {
    onchainChannelId: bigint;
    cumulativeAmount: bigint;
    nonce: bigint;
    signature: Buffer;
  }): Promise<ClaimResult> {
    const { rows } = await pool.query(
      `SELECT payer_pubkey, deposited, pending_amount, pending_nonce, status
       FROM x402_channels WHERE onchain_channel_id = $1`,
      [params.onchainChannelId.toString()],
    );
    if (rows.length === 0) {
      return { accepted: false, reason: 'channel_not_found' };
    }
    const row = rows[0] as {
      payer_pubkey: string;
      deposited: string;
      pending_amount: string;
      pending_nonce: string;
      status: string;
    };

    // Once a channel is winding down, the off-chain fast path stops
    // extending new credit — this endpoint is for accumulating claims
    // during normal operation, not for negotiating a dispute (that's the
    // on-chain checkpoint() call itself, driven by the keeper).
    if (row.status !== 'open') {
      return { accepted: false, reason: 'channel_not_open' };
    }

    const pendingAmount = BigInt(row.pending_amount);
    const pendingNonce = BigInt(row.pending_nonce);
    const deposited = BigInt(row.deposited);

    // Same monotonicity + capacity checks the contract itself enforces in
    // checkpoint() — mirrored here so a bad claim never even gets stored,
    // not just eventually rejected on-chain.
    if (params.nonce <= pendingNonce || params.cumulativeAmount <= pendingAmount) {
      return { accepted: false, reason: 'stale_claim' };
    }
    if (params.cumulativeAmount > deposited) {
      return { accepted: false, reason: 'exceeds_deposit' };
    }

    const valid = verifyClaimSignature({
      channelId: params.onchainChannelId,
      nonce: params.nonce,
      cumulativeAmount: params.cumulativeAmount,
      payerPubkey: Buffer.from(row.payer_pubkey, 'hex'),
      signature: params.signature,
    });
    if (!valid) {
      this.logger.warn(`rejected claim with invalid signature for channel ${params.onchainChannelId}`);
      return { accepted: false, reason: 'invalid_signature' };
    }

    await pool.query(
      `UPDATE x402_channels
       SET pending_amount = $2, pending_nonce = $3, pending_signature = $4, last_activity_at = NOW(), updated_at = NOW()
       WHERE onchain_channel_id = $1`,
      [params.onchainChannelId.toString(), params.cumulativeAmount.toString(), params.nonce.toString(), params.signature.toString('hex')],
    );

    return { accepted: true };
  }

  // Same client-signs-facilitator-submits pattern @x402/stellar's own
  // ExactStellarScheme.settle() uses for transfer() — confirmed by reading
  // its actual implementation rather than assumed: the payer builds and
  // signs a transaction invoking open_channel locally (their own auth
  // entry embedded, no submission), sends the resulting XDR here. The
  // facilitator parses it, validates it's genuinely open_channel targeting
  // this contract (not something else the payer tricked us into signing),
  // runs compliance on the extracted payer address, then rebuilds the
  // transaction with itself as source/fee-payer, signs, and submits.
  async openChannel(params: { transactionXdr: string; resourceUrl?: string }): Promise<OpenChannelResult> {
    const server = new rpc.Server(RPC_URL);
    let transaction: Transaction;
    try {
      transaction = new Transaction(params.transactionXdr, Networks.TESTNET);
    } catch {
      return { success: false, errorReason: 'malformed_transaction' };
    }

    if (transaction.operations.length !== 1) {
      return { success: false, errorReason: 'wrong_operation_count' };
    }
    const operation = transaction.operations[0];
    if (operation.type !== 'invokeHostFunction') {
      return { success: false, errorReason: 'wrong_operation_type' };
    }

    const signer = await getFacilitatorSigner();
    // The facilitator must never be the transaction/operation source of a
    // transaction someone else handed us to submit — same safety check
    // ExactStellarScheme applies to the single-shot settle path.
    if ((operation.source ?? transaction.source) === signer.address) {
      return { success: false, errorReason: 'unsafe_tx_source' };
    }

    const func = operation.func;
    if (!func || func.switch().name !== 'hostFunctionTypeInvokeContract') {
      return { success: false, errorReason: 'wrong_operation_type' };
    }
    const invokeArgs = func.invokeContract();
    const contractAddress = Address.fromScAddress(invokeArgs.contractAddress()).toString();
    const functionName = invokeArgs.functionName().toString();
    const args = invokeArgs.args();
    if (contractAddress !== CHANNEL_CONTRACT_ID) {
      return { success: false, errorReason: 'wrong_contract' };
    }
    if (functionName !== 'open_channel' || args.length !== 5) {
      return { success: false, errorReason: 'wrong_function' };
    }

    const payerAddress = scValToNative(args[0]) as string;
    const payeeAddress = scValToNative(args[1]) as string;
    const tokenAddress = scValToNative(args[2]) as string;
    const payerPubkey = scValToNative(args[3]) as Buffer;
    const deposit = scValToNative(args[4]) as bigint;

    if (payerAddress === signer.address) {
      return { success: false, errorReason: 'facilitator_is_payer' };
    }

    // Compliance gate, once, at open time — not deferred to settlement.
    // Reuses the exact shared check already protecting checkout and
    // single-shot x402 settlement, not new logic.
    const { rows: blocked } = await pool.query('SELECT 1 FROM blocked_addresses WHERE stellar_address = $1', [payerAddress]);
    if (blocked.length > 0 || !(await isAllowedOnChain(payerAddress))) {
      return { success: false, errorReason: 'compliance_blocked' };
    }

    let simResponse: rpc.Api.SimulateTransactionResponse;
    try {
      simResponse = await server.simulateTransaction(transaction);
    } catch (err) {
      this.logger.error(`open_channel simulation failed: ${err}`);
      return { success: false, errorReason: 'simulation_failed' };
    }
    if (!rpc.Api.isSimulationSuccess(simResponse)) {
      return { success: false, errorReason: 'simulation_failed' };
    }

    let sentHash: string;
    try {
      const facilitatorAccount = await server.getAccount(signer.address);
      const sorobanData = simResponse.transactionData.build();
      const rebuiltTx = new TransactionBuilder(facilitatorAccount, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
        sorobanData,
      })
        .setTimeout(60)
        .addOperation(Operation.invokeHostFunction(operation))
        .build();

      const { signedTxXdr, error: signError } = await signer.signTransaction(rebuiltTx.toXDR(), {
        networkPassphrase: Networks.TESTNET,
      });
      if (signError || !signedTxXdr) {
        return { success: false, errorReason: 'signing_failed' };
      }

      const txToSubmit = TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET);
      const sendResult = await server.sendTransaction(txToSubmit);
      if (sendResult.status !== 'PENDING') {
        return { success: false, errorReason: 'submission_failed' };
      }
      sentHash = sendResult.hash;
    } catch (err) {
      this.logger.error(`open_channel submission failed: ${err}`);
      return { success: false, errorReason: 'submission_failed' };
    }

    const confirmed = await this.pollForTransaction(server, sentHash);
    if (!confirmed.success) {
      return { success: false, errorReason: 'transaction_failed', transaction: sentHash };
    }

    const onchainChannelId = (confirmed.returnValue as bigint).toString();
    await pool.query(
      `INSERT INTO x402_channels (onchain_channel_id, payer_address, payee_address, asset_contract, payer_pubkey, deposited, resource_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (onchain_channel_id) DO NOTHING`,
      [onchainChannelId, payerAddress, payeeAddress, tokenAddress, payerPubkey.toString('hex'), deposit.toString(), params.resourceUrl ?? null],
    );

    return { success: true, onchainChannelId, transaction: sentHash };
  }

  private async pollForTransaction(
    server: rpc.Server,
    txHash: string,
    maxAttempts = 15,
    delayMs = 1000,
  ): Promise<{ success: boolean; returnValue?: unknown }> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const result = await server.getTransaction(txHash);
        if (result.status === 'SUCCESS') {
          return { success: true, returnValue: result.returnValue ? scValToNative(result.returnValue) : undefined };
        }
        if (result.status === 'FAILED') {
          return { success: false };
        }
      } catch {
        // NOT_FOUND while still pending — expected, keep polling.
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return { success: false };
  }
}
