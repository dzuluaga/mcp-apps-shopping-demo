import { describe, it, expect } from "vitest";
import { buildBindingFields, buildPasskeyMandate, runGates } from "./mandate.js";
import type { Order } from "../catalog.js";

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
