// Proves the exact output of our own /payments/prepare-tx endpoint is a
// valid, signable, submittable transaction — not a similar one built
// separately. This is what the browser checkout page does; here it's done
// headlessly since there's no browser/Freighter in this environment.
const { Keypair, Horizon, TransactionBuilder } = require("@stellar/stellar-sdk");

const API_BASE = "http://localhost:3001";
const HORIZON_URL = "https://horizon-testnet.stellar.org";
const server = new Horizon.Server(HORIZON_URL);

async function fund(publicKey) {
  const res = await fetch(`https://friendbot.stellar.org?addr=${publicKey}`);
  if (!res.ok) throw new Error(`friendbot failed: ${res.status}`);
}

async function main() {
  const linkId = process.argv[2];
  const muxedId = process.argv[3] || String(Date.now());

  const payer = Keypair.random();
  process.stderr.write(`funding payer ${payer.publicKey()} ...\n`);
  await fund(payer.publicKey());

  process.stderr.write(`reserving session ${muxedId} ...\n`);
  const sessionRes = await fetch(`${API_BASE}/links/${linkId}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ muxed_id: muxedId }),
  });
  if (!sessionRes.ok) throw new Error(`session reserve failed: ${await sessionRes.text()}`);

  process.stderr.write(`calling our own prepare-tx ...\n`);
  const prepRes = await fetch(
    `${API_BASE}/payments/prepare-tx?linkId=${linkId}&muxed_id=${muxedId}&payer=${payer.publicKey()}`,
  );
  const prep = await prepRes.json();
  if (!prepRes.ok) throw new Error(`prepare-tx failed: ${JSON.stringify(prep)}`);

  const tx = TransactionBuilder.fromXDR(prep.xdr, prep.network_passphrase);
  tx.sign(payer);

  process.stderr.write(`submitting the API-built, locally-signed transaction ...\n`);
  const result = await server.submitTransaction(tx);

  console.log(JSON.stringify({ payer: payer.publicKey(), muxedId, txHash: result.hash, muxedAddress: prep.muxed_address }, null, 2));
}

main().catch((err) => {
  console.error(err.response?.data ?? err);
  process.exit(1);
});
