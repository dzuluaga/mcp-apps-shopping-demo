import express, { type Express, type Request, type Response } from "express";
import { decodeOrder } from "../../checkout.js";
import { deriveOrigin } from "../origin.js";
import { gateSecret } from "../challengeToken.js";
import { buildBindingFields } from "../mandate.js";
import { buildSignedRequest } from "./request.js";
import { verifyDcPresentation } from "./verify.js";
import { renderDcPage } from "./page.js";

function originOf(req: Request) {
  return deriveOrigin({ headers: req.headers, host: req.get("host") ?? "localhost", protocol: req.protocol });
}

export function registerDcPaymentGate(app: Express): void {
  app.get("/payment-gate/dc-payment", (req: Request, res: Response) => {
    const token = typeof req.query.order === "string" ? req.query.order : undefined;
    const order = token ? decodeOrder(token) : undefined;
    if (!order || !token) {
      res.status(404).type("html").send("<!doctype html><h1>Order not found</h1>");
      return;
    }
    try {
      res.status(200).type("html").send(renderDcPage({ order, orderToken: token }));
    } catch {
      res.status(404).type("html").send("<!doctype html><h1>Order not found</h1>");
    }
  });

  app.get("/payment-gate/dc-payment/request", async (req: Request, res: Response) => {
    const token = typeof req.query.order === "string" ? req.query.order : undefined;
    const order = token ? decodeOrder(token) : undefined;
    if (!order) {
      res.status(400).json({ error: "invalid order token" });
      return;
    }
    try {
      const { request, readerContextToken } = await buildSignedRequest(order, originOf(req), gateSecret());
      res.json({ request, readerContextToken });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // The wallet's encrypted vp_token can be large; raise the JSON limit on this route.
  app.post("/payment-gate/dc-payment/verify", express.json({ limit: "4mb" }), async (req: Request, res: Response) => {
    const { orderToken, readerContextToken, result } = req.body ?? {};
    const order = typeof orderToken === "string" ? decodeOrder(orderToken) : undefined;
    if (!order) {
      res.status(400).json({ error: "invalid order token" });
      return;
    }
    try {
      const origin = originOf(req);
      const { mandate, gates } = await verifyDcPresentation({ order, result, readerContextToken, secret: gateSecret() });
      res.json({ mandate, gates, binding: buildBindingFields(order, origin) });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });
}
