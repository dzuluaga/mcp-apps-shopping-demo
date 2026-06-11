import express, { type Express, type Request, type Response } from "express";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { decodeOrder, isAgeUnverified } from "../../checkout.js";
import { cartStore } from "../../cartStore.js";
import { orderStore } from "../../orderStore.js";
import { verificationStore } from "../../verificationStore.js";
import { deriveOrigin } from "../origin.js";
import { gateSecret } from "../challengeToken.js";
import { buildPasskeyMandate, buildBindingFields, runGates } from "../mandate.js";
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
      const mandate = buildPasskeyMandate({ order, authenticator, origin });
      const gates = runGates(mandate);
      // Server-side age gate — refuse to complete an age-restricted order that
      // has no recorded age verification, even if the payment gates pass.
      if (await isAgeUnverified(order)) {
        res.status(403).json({ mandate, gates, completed: false, error: "Age verification required for this order." });
        return;
      }
      // Only a fully-authorized mandate completes the purchase: record it for the
      // agent to poll and clear the shared cart so the next session starts fresh.
      const completed = gates.every((g) => g.pass);
      if (completed) {
        await orderStore.write({
          orderId: order.id,
          mandateId: mandate.id,
          amount: mandate.payment.amount,
          currency: mandate.payment.currency,
          method: "passkey",
          instrument: { issuer: mandate.payment.instrument, maskedAccount: mandate.payment.instrumentReference, holder: null },
          gates: gates.map((g) => ({ gate: g.gate, pass: g.pass, detail: g.detail })),
          completedAt: new Date().toISOString(),
        });
        await cartStore.write(new Map());
        // Completed purchase: clear this order's verification.
        await verificationStore.clear(order.id);
      }
      res.json({ mandate, gates, completed, binding: buildBindingFields(order, origin) });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });
}
