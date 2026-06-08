import { describe, it, expect } from "vitest";
import { buildBindingFields } from "./mandate.js";
import type { Order } from "../catalog.js";

// The AP2 mandate + the validation gates now live in the Python sidecar
// (tested under ap2-sidecar/tests/). What remains here is the binding-fields
// derivation the gates and the page receipt consume.

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
