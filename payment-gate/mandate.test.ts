import { describe, it, expect } from "vitest";
import { buildBindingFields, buildPasskeyMandate, runGates } from "./mandate.js";
import { createOrder, type Order } from "../catalog.js";

const order: Order = {
  id: "ORD-TEST01",
  lines: [
    { id: "atlas-stand", name: "Atlas Laptop Stand", unitPrice: 49, currency: "USD", quantity: 2, lineTotal: 98 },
    { id: "drift-mouse", name: "Drift Ergonomic Mouse", unitPrice: 69, currency: "USD", quantity: 1, lineTotal: 69 },
  ],
  itemCount: 3,
  total: 167,
  currency: "USD",
  createdAt: "2026-05-31T00:00:00.000Z",
};

const verifiedAuthenticator = {
  credentialID: "cred-abc",
  userVerified: true,
  credentialDeviceType: "multiDevice" as const,
  credentialBackedUp: true,
};

describe("buildBindingFields", () => {
  it("derives amount/currency/payee/orderId from the order + origin", () => {
    const fields = buildBindingFields(order, { rpID: "localhost", origin: "http://localhost:3001" });
    expect(fields).toEqual({
      amount: 167,
      currency: "USD",
      payee: { id: "localhost", name: "Product Picker Demo" },
      orderId: "ORD-TEST01",
    });
  });
});

describe("buildPasskeyMandate + runGates", () => {
  it("produces an ap2.PaymentMandate whose four gates all pass", () => {
    const mandate = buildPasskeyMandate({
      order,
      authenticator: verifiedAuthenticator,
      origin: { rpID: "localhost", origin: "http://localhost:3001" },
    });
    expect(mandate.type).toBe("ap2.PaymentMandate");
    expect(mandate.payment.amount).toBe(167);
    const gates = runGates(mandate);
    expect(gates).toHaveLength(4);
    expect(gates.every((g) => g.pass)).toBe(true);
    expect(gates.map((g) => g.gate)).toEqual([
      "Amount integrity",
      "Authorization present",
      "User verification",
      "Subject binding",
    ]);
  });

  it("fails Gate 1 when payment.amount is tampered (re-derived from cart lines)", () => {
    const mandate = buildPasskeyMandate({
      order,
      authenticator: verifiedAuthenticator,
      origin: { rpID: "localhost", origin: "http://localhost:3001" },
    });
    mandate.payment.amount = 1; // tamper
    const gates = runGates(mandate);
    expect(gates.find((g) => g.gate === "Amount integrity")!.pass).toBe(false);
  });

  it("fails Gate 4 when subject and authorization credentialIDs disagree", () => {
    const mandate = buildPasskeyMandate({
      order,
      authenticator: verifiedAuthenticator,
      origin: { rpID: "localhost", origin: "http://localhost:3001" },
    });
    mandate.subject.credentialID = "someone-else";
    expect(runGates(mandate).find((g) => g.gate === "Subject binding")!.pass).toBe(false);
  });
});

describe("runGates — loyalty discount (Gate 1)", () => {
  const origin = { rpID: "localhost", origin: "http://localhost:3001" };

  it("Gate 1 passes for a 10%-discounted order (lines stay undiscounted, total is discounted)", () => {
    // champagne $89 → subtotal 89, discount 8.9, total 80.1; line stays 89.
    const discounted = createOrder([{ productId: "celebration-champagne", quantity: 1 }], "ORD-LOY", { loyaltyApplied: true });
    expect(discounted.total).toBe(80.1);
    expect(discounted.lines[0].lineTotal).toBe(89);
    const mandate = buildPasskeyMandate({ order: discounted, authenticator: verifiedAuthenticator, origin });
    expect(mandate.payment.amount).toBe(80.1);
    const gate1 = runGates(mandate).find((g) => g.gate === "Amount integrity")!;
    expect(gate1.pass).toBe(true);
  });

  it("Gate 1 fails when the order claims a discount larger than the loyalty percentage (tampered token)", () => {
    const base = createOrder([{ productId: "celebration-champagne", quantity: 1 }], "ORD-TAMPER", { loyaltyApplied: true });
    const tampered: Order = { ...base, discount: 44.5, total: 44.5 }; // 50% off, not earned
    const mandate = buildPasskeyMandate({ order: tampered, authenticator: verifiedAuthenticator, origin });
    expect(runGates(mandate).find((g) => g.gate === "Amount integrity")!.pass).toBe(false);
  });
});
