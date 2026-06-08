import express, { type Express, type Request, type Response } from "express";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { decodeOrder } from "../../checkout.js";
import { cartStore } from "../../cartStore.js";
import { orderStore } from "../../orderStore.js";
import { deriveOrigin } from "../origin.js";
import { gateSecret } from "../challengeToken.js";
import { buildBindingFields } from "../mandate.js";
import { buildMandate, verifyMandate } from "../ap2Client.js";
import { buildRegistrationOptions, verifyPasskeyAssertion } from "./verify.js";
import { renderPasskeyPage } from "./page.js";

function originOf(req: Request) {
  return deriveOrigin({ headers: req.headers, host: req.get("host") ?? "localhost", protocol: req.protocol });
}

export function registerPasskeyGate(app: Express): void {
  // Serve @simplewebauthn/browser ESM from a same-origin path (no CDN).
  // createRequire resolves to script/index.js (the `main` field); two dirname
  // calls walk up from script/ to the package root, then we append /esm.
  const requireFrom = createRequire(import.meta.url);
  const scriptIndexPath = requireFrom.resolve("@simplewebauthn/browser");
  const browserEsmDir = path.join(path.dirname(path.dirname(scriptIndexPath)), "esm");
  // Fail loudly at startup if the package layout changed, instead of silently
  // 404-ing the browser module and breaking the gate with a confusing client error.
  if (!existsSync(path.join(browserEsmDir, "index.js"))) {
    throw new Error(`@simplewebauthn/browser ESM not found at ${browserEsmDir}`);
  }
  app.use("/payment-gate/lib/sw", express.static(browserEsmDir));

  app.get("/payment-gate/passkey", (req: Request, res: Response) => {
    const token = typeof req.query.order === "string" ? req.query.order : undefined;
    const order = token ? decodeOrder(token) : undefined;
    if (!order || !token) {
      res.status(404).type("html").send("<!doctype html><h1>Order not found</h1>");
      return;
    }
    // decodeOrder only checks top-level shape; a hand-edited token can still carry
    // a bad currency that throws in Intl.NumberFormat. Mirror checkoutResponse's
    // guard so an unsigned, attacker-editable token can't 500 the route.
    try {
      res.status(200).type("html").send(renderPasskeyPage({ order, orderToken: token, crossDevice: req.query.xdev === "1" }));
    } catch {
      res.status(404).type("html").send("<!doctype html><h1>Order not found</h1>");
    }
  });

  app.get("/payment-gate/passkey/options", async (req: Request, res: Response) => {
    const { options, challengeToken } = await buildRegistrationOptions(originOf(req), gateSecret(), {
      crossDevice: req.query.xdev === "1",
    });
    res.json({ options, challengeToken });
  });

  app.post("/payment-gate/passkey/verify", async (req: Request, res: Response) => {
    const { response, challengeToken, orderToken } = req.body ?? {};
    const order = typeof orderToken === "string" ? decodeOrder(orderToken) : undefined;
    if (!order) {
      res.status(400).json({ error: "invalid order token" });
      return;
    }
    try {
      const origin = originOf(req);
      const authenticator = await verifyPasskeyAssertion({ response, challengeToken, origin, secret: gateSecret() });
      // Device evidence carried into the signed AP2 mandate (the sidecar checks
      // it but does not re-run the WebAuthn crypto — that ran just above).
      const authorization = {
        type: "webauthn.assertion",
        credentialId: authenticator.credentialID,
        userVerified: authenticator.userVerified,
        deviceType: authenticator.credentialDeviceType,
        hardwareBacked: authenticator.credentialDeviceType === "singleDevice",
        backedUp: authenticator.credentialBackedUp,
        rpId: origin.rpID,
        origin: origin.origin,
      };
      // The AP2 sidecar mints the SD-JWT PaymentMandate and runs the gates.
      const built = await buildMandate({ order, channel: "passkey", authorization, payeeId: origin.rpID });
      const verdict = await verifyMandate({
        mandate: built.mandate,
        expectedAmount: order.total,
        expectedCurrency: order.currency,
        expectedPayeeId: origin.rpID,
      });
      const gates = verdict.gates;
      // Only a fully-authorized mandate completes the purchase: record it for the
      // agent to poll and clear the shared cart so the next session starts fresh.
      const completed = verdict.valid;
      if (completed) {
        await orderStore.write({
          orderId: order.id,
          mandateId: built.mandateId,
          amount: order.total,
          currency: order.currency,
          method: "passkey",
          instrument: { issuer: "ap2-passkey", maskedAccount: authenticator.credentialID, holder: null },
          gates,
          completedAt: new Date().toISOString(),
          mandate: built.mandate,
        });
        await cartStore.write(new Map());
      }
      // The page receipt reads mandate.id + gates; carry the SD-JWT token too.
      res.json({ mandate: { id: built.mandateId, format: "ap2-sdjwt", token: built.mandate }, gates, completed, binding: buildBindingFields(order, origin) });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });
}
