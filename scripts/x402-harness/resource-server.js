// A standard x402 resource server (the official @x402/express package,
// unmodified) protecting one paid endpoint — proving Konfirm's facilitator
// (src/x402/) works against real, off-the-shelf x402 tooling, not just its
// own client. Follows skills.stellar.org's agentic-payments skill "Seller"
// example verbatim, with one deliberate change: the facilitator client
// points at Konfirm's own /x402 endpoints instead of OZ Channels, and no
// OZ_API_KEY / auth header is needed since those endpoints are open by
// design (same reasoning as deposits.controller.ts).
import "dotenv/config";
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactStellarScheme } from "@x402/stellar/exact/server";

const NETWORK = "stellar:testnet";
const PORT = 4021;

const facilitatorUrl = process.env.KONFIRM_FACILITATOR_URL;
const payTo = process.env.STELLAR_RECIPIENT;
if (!facilitatorUrl || !payTo) {
  throw new Error("KONFIRM_FACILITATOR_URL and STELLAR_RECIPIENT are required — run setup.js first, see README below.");
}

const facilitator = new HTTPFacilitatorClient({ url: facilitatorUrl });

const resourceServer = new x402ResourceServer(facilitator).register(NETWORK, new ExactStellarScheme());

const app = express();

app.use(
  paymentMiddleware(
    {
      "GET /paid-resource": {
        accepts: {
          scheme: "exact",
          price: "$0.001",
          network: NETWORK,
          payTo,
        },
        description: "x402-harness proof resource — proves Konfirm's facilitator against the official @x402/express resource server.",
      },
    },
    resourceServer,
  ),
);

app.get("/paid-resource", (_req, res) => {
  res.json({ message: "payment verified and settled — this is the paid content", servedAt: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`x402 resource server on http://localhost:${PORT} (${NETWORK})`);
  console.log(`facilitator: ${facilitatorUrl}`);
  console.log(`payTo:       ${payTo}`);
});
