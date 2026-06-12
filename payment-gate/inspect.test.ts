import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { createOrder } from "../catalog.js";
import { encodeOrder } from "../checkout.js";
import { orderStore } from "../orderStore.js";
import { buildPasskeyMandate } from "./mandate.js";
import { inspectArtifact } from "./inspect.js";

const ORIGIN = { rpID: "localhost", origin: "http://localhost:3001" };

function passkeyMandate(orderId = "ORD-INSP1") {
  const order = createOrder([{ productId: "drift-mouse", quantity: 1 }], orderId);
  return buildPasskeyMandate({
    order,
    authenticator: {
      credentialID: "cred-abc",
      userVerified: true,
      credentialDeviceType: "singleDevice",
      credentialBackedUp: false,
    },
    origin: ORIGIN,
  });
}

beforeEach(async () => {
  await orderStore.clear();
});

describe("inspectArtifact", () => {
  it("detects a passkey mandate and runs the four gates green", async () => {
    const result = await inspectArtifact(JSON.stringify(passkeyMandate()), ORIGIN);
    expect(result.kind).toBe("passkey-mandate");
    expect(result.gates).toHaveLength(4);
    expect(result.gates!.every((g) => g.pass)).toBe(true);
    expect(result.mandate?.id).toMatch(/^mandate_pm_/);
  });

  it("a tampered amount turns gate 1 red — the badge is real validation", async () => {
    const m = passkeyMandate();
    m.payment.amount = 999999;
    const result = await inspectArtifact(JSON.stringify(m), ORIGIN);
    expect(result.gates![0].pass).toBe(false);
    expect(result.gates!.some((g) => g.pass)).toBe(true); // others unaffected
  });

  it("routes a dc-shaped mandate to the DC gates without throwing on junk vpToken", async () => {
    const m = {
      type: "ap2.PaymentMandate",
      version: "0.1-dc",
      id: "mandate_pm_junk",
      subject: { credentialId: null },
      cart: createOrder([{ productId: "drift-mouse", quantity: 1 }], "ORD-DCJUNK"),
      payment: { instrument: {}, amount: 69, currency: "USD" },
      userAuthorization: { type: "openid4vp-dc-api", transactionData: "!!!", transactionDataHash: null, vpToken: "%%%", verified: false },
    };
    const result = await inspectArtifact(JSON.stringify(m), ORIGIN);
    expect(result.kind).toBe("dc-mandate");
    expect(Array.isArray(result.gates)).toBe(true);
    expect(result.gates!.some((g) => !g.pass)).toBe(true); // junk fails, never 500s
  });

  it("detects an order token and marks it non-authoritative (no gates)", async () => {
    const order = createOrder([{ productId: "drift-mouse", quantity: 1 }], "ORD-TOK1");
    const result = await inspectArtifact(encodeOrder(order), ORIGIN);
    expect(result.kind).toBe("order-token");
    expect(result.order?.id).toBe("ORD-TOK1");
    expect(result.gates).toBeUndefined();
    expect(result.note).toMatch(/unsigned/i);
  });

  it("garbage input → kind unknown with an error message, no throw", async () => {
    const result = await inspectArtifact("not json, not base64url!!", ORIGIN);
    expect(result.kind).toBe("unknown");
    expect(result.error).toBeTruthy();
  });

  it("attaches the recorded settlement only when the orderId matches", async () => {
    const m = passkeyMandate("ORD-SETTLED1");
    await orderStore.write({
      orderId: "ORD-SETTLED1",
      mandateId: m.id,
      amount: m.payment.amount,
      currency: "USD",
      method: "passkey",
      instrument: null,
      gates: [],
      completedAt: new Date().toISOString(),
      settlement: {
        network: "hedera-testnet",
        payer: { accountId: "0.0.1", kind: "house" },
        payTo: "0.0.2",
        amountTinybar: 690_000,
        fxRate: "1 USD = 0.0001 HBAR (demo peg)",
        txId: "0.0.7162784@1700000000.000000000",
        hashscanUrl: "https://hashscan.io/testnet/transaction/x",
        settledInMs: 4000,
        walletAgeMs: 0,
        status: "settled",
        facilitator: "blocky402",
      },
    });
    const hit = await inspectArtifact(JSON.stringify(m), ORIGIN);
    expect(hit.settlement?.txId).toContain("0.0.7162784");
    const miss = await inspectArtifact(JSON.stringify(passkeyMandate("ORD-OTHER")), ORIGIN);
    expect(miss.settlement).toBeUndefined();
  });
});

describe("inspect routes", () => {
  const app = () => createApp({ publicBaseUrl: "http://localhost:3001" });

  it("GET /payment-gate/inspect renders the page with esc-ed client rendering and the honesty note", async () => {
    const res = await request(app()).get("/payment-gate/inspect");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Mandate inspector");
    // Pasted-derived values must flow through the client esc() helper.
    expect(res.text).toContain("esc(");
    // Honest framing: mock signer, AP2-shaped — not spec-conformant signatures.
    expect(res.text).toContain("AP2-shaped");
    expect(res.text).toContain("mock");
    expect(res.text).toContain("pp:lastMandate"); // prefilled from the gate receipt
  });

  it("POST /validate inspects a mandate end to end over HTTP", async () => {
    const res = await request(app())
      .post("/payment-gate/inspect/validate")
      .send({ input: JSON.stringify(passkeyMandate()) });
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("passkey-mandate");
    expect(res.body.gates).toHaveLength(4);
  });

  it("POST /validate rejects oversized input (paste box is attacker-controlled)", async () => {
    const res = await request(app())
      .post("/payment-gate/inspect/validate")
      .send({ input: "x".repeat(600_000) });
    expect([400, 413]).toContain(res.status);
  });

  it("POST /validate with a non-string input → 400", async () => {
    const res = await request(app()).post("/payment-gate/inspect/validate").send({ input: { nested: true } });
    expect(res.status).toBe(400);
  });
});
