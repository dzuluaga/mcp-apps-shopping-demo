import { describe, it, expect } from "vitest";
import { createOrder } from "../../catalog.js";
import { buildTransactionData, encodeTransactionData, hashTransactionData } from "./txData.js";

const origin = { rpID: "localhost", origin: "http://localhost:3030" };

describe("txData", () => {
  it("binds amount, currency, and payee from the order + origin", () => {
    const order = createOrder([{ productId: "drift-mouse", quantity: 2 }], "ORD-TX01");
    const td = buildTransactionData(order, origin);
    expect(td.type).toBe("urn:eudi:sca:payment:1");
    expect(td.payload.amount).toBe(order.total);
    expect(td.payload.currency).toBe(order.currency);
    expect(td.payload.payee.id).toBe("localhost");
    expect(td.payload.transaction_id).toMatch(/[0-9a-f-]{36}/);
  });

  it("mints a fresh transaction_id each call", () => {
    const order = createOrder([{ productId: "drift-mouse", quantity: 1 }], "ORD-TX02");
    expect(buildTransactionData(order, origin).payload.transaction_id)
      .not.toBe(buildTransactionData(order, origin).payload.transaction_id);
  });

  it("encode + hash are deterministic for the same base64url string", () => {
    const order = createOrder([{ productId: "drift-mouse", quantity: 1 }], "ORD-TX03");
    const b64 = encodeTransactionData(buildTransactionData(order, origin));
    expect(hashTransactionData(b64)).toBe(hashTransactionData(b64));
    expect(hashTransactionData(b64)).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
