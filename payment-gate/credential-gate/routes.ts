import express, { type Express, type Request, type Response } from "express";
import { deriveOrigin } from "../origin.js";
import { gateSecret } from "../challengeToken.js";
import { verificationStore } from "../../verificationStore.js";
import { buildCredentialRequest } from "./request.js";
import { verifyCredentialPresentation } from "./verify.js";
import { renderCredentialPage } from "./page.js";
import type { CredentialKind } from "./dcql.js";
import { decodeOrder } from "../../checkout.js";
import { requiredAgeForLines } from "../../catalog.js";

// Decode the order token the gate URL carries. Both the age threshold and the
// verification key are derived from it, so the gate is always scoped to one order.
function orderFromToken(token: unknown) {
  return typeof token === "string" ? decodeOrder(token) : undefined;
}

// Threshold for the age gate, derived from the order's products. Falls back to
// 21 (strictest common restriction) when the order can't be read.
function requiredAgeFromOrder(order: ReturnType<typeof orderFromToken>): number {
  return (order && requiredAgeForLines(order.lines)) ?? 21;
}

function originOf(req: Request) {
  return deriveOrigin({ headers: req.headers, host: req.get("host") ?? "localhost", protocol: req.protocol });
}

function parseKind(raw: string | string[] | undefined): CredentialKind | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "age" || value === "loyalty" ? value : null;
}

// Persist a successful verification, scoped to the order being checked out.
async function recordVerified(orderId: string, kind: CredentialKind, membershipNumber: string | null): Promise<void> {
  if (kind === "age") {
    await verificationStore.write(orderId, { ageVerified: true });
  } else {
    await verificationStore.write(orderId, { loyalty: { applied: true, membershipNumber } });
  }
}

export function registerCredentialGate(app: Express): void {
  app.get("/credential-gate/:kind", (req: Request, res: Response) => {
    const kind = parseKind(req.params.kind);
    if (!kind) { res.status(404).type("html").send("<!doctype html><h1>Unknown gate</h1>"); return; }
    const order = typeof req.query.order === "string" ? req.query.order : undefined;
    res.status(200).type("html").send(renderCredentialPage({ kind, order }));
  });

  app.get("/credential-gate/:kind/request", async (req: Request, res: Response) => {
    const kind = parseKind(req.params.kind);
    if (!kind) { res.status(404).json({ error: "unknown gate" }); return; }
    try {
      const out = await buildCredentialRequest(kind, originOf(req), gateSecret());
      res.json(out);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/credential-gate/:kind/verify", express.json({ limit: "4mb" }), async (req: Request, res: Response) => {
    const kind = parseKind(req.params.kind);
    if (!kind) { res.status(404).json({ error: "unknown gate" }); return; }
    const { readerContextToken, result, order: orderToken } = req.body ?? {};
    const order = orderFromToken(orderToken);
    if (!order) { res.status(400).json({ verified: false, error: "missing or invalid order" }); return; }
    try {
      const minimumAge = kind === "age" ? requiredAgeFromOrder(order) : undefined;
      const out = await verifyCredentialPresentation({ kind, result, readerContextToken, secret: gateSecret(), minimumAge });
      if (out.verified) await recordVerified(order.id, kind, out.membershipNumber);
      res.json(out);
    } catch (err) {
      res.status(400).json({ verified: false, error: (err as Error).message });
    }
  });

  // Instant-demo path: no real credential exchange, just mark verified for this
  // order. Mirrors the payment gate's "Place order (instant demo)".
  app.post("/credential-gate/:kind/demo", express.json(), async (req: Request, res: Response) => {
    const kind = parseKind(req.params.kind);
    if (!kind) { res.status(404).json({ error: "unknown gate" }); return; }
    const order = orderFromToken(req.body?.order);
    if (!order) { res.status(400).json({ verified: false, error: "missing or invalid order" }); return; }
    await recordVerified(order.id, kind, kind === "loyalty" ? "DEMO-LOYALTY" : null);
    res.json({ verified: true, gates: [{ gate: kind === "age" ? "Age over 21" : "Loyalty membership", pass: true, detail: "instant demo" }] });
  });
}
