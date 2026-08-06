// Test harness standing in for a payer's wallet (Freighter/Albedo). This is
// exactly the role a real wallet plays: load the account, build a payment op
// to a muxed destination, sign, submit directly to Horizon. Konfirm's API
// is not in this path in production either — this script proves that by
// construction, since nothing here talks to any Konfirm service.
const {
  Keypair,
  Horizon,
  Account,
  MuxedAccount,
  TransactionBuilder,
  Operation,
  Asset,
  Networks,
  BASE_FEE,
} = require("@stellar/stellar-sdk");

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const server = new Horizon.Server(HORIZON_URL);

async function fund(publicKey) {
  const res = await fetch(`https://friendbot.stellar.org?addr=${publicKey}`);
  if (!res.ok) throw new Error(`friendbot failed for ${publicKey}: ${res.status}`);
  return res.json();
}

async function main() {
  const muxedId = process.argv[2] || "1";
  const amount = process.argv[3] || "12.5000000";
  const existingMerchantPublicKey = process.argv[4]; // optional: reuse a merchant base account

  // Receiving a payment needs only the merchant's public key — deriving the
  // muxed sub-address never requires their signing key, since the merchant
  // isn't a party to the payer's transaction at all.
  const merchantPublicKey = existingMerchantPublicKey || Keypair.random().publicKey();
  const payer = Keypair.random(); // stands in for the customer's wallet

  if (!existingMerchantPublicKey) {
    process.stderr.write(`funding merchant ${merchantPublicKey} ...\n`);
    await fund(merchantPublicKey);
  }
  process.stderr.write(`funding payer ${payer.publicKey()} ...\n`);
  await fund(payer.publicKey());

  // The muxed address is derived client-side, with zero server round trip —
  // this is the whole point of the redesign in §1: it's arithmetic over the
  // merchant's own base account, not a row anyone had to create first.
  const merchantAccountForMux = new Account(merchantPublicKey, "0");
  const muxed = new MuxedAccount(merchantAccountForMux, muxedId);
  const destination = muxed.accountId();

  const payerAccount = await server.loadAccount(payer.publicKey());
  const tx = new TransactionBuilder(payerAccount, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination,
        asset: Asset.native(),
        amount,
      })
    )
    .setTimeout(60)
    .build();
  tx.sign(payer);

  process.stderr.write(`submitting payment to ${destination} ...\n`);
  const result = await server.submitTransaction(tx);

  console.log(
    JSON.stringify(
      {
        merchantBaseAddress: merchantPublicKey,
        payerAddress: payer.publicKey(),
        muxedId,
        muxedAddress: destination,
        amount,
        txHash: result.hash,
        ledger: result.ledger,
        explorer: `https://stellar.expert/explorer/testnet/tx/${result.hash}`,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err.response?.data ?? err);
  process.exit(1);
});
