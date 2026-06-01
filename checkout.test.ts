import { describe, it, expect } from "vitest";
import { CATALOG } from "./catalog.js";
import { createCheckoutOrder, getOrder, checkoutResponse } from "./checkout.js";

describe("createCheckoutOrder", () => {
  it("creates a retrievable order and a checkout URL containing its id", () => {
    const { orderId, checkoutUrl } = createCheckoutOrder([
      { productId: CATALOG[0].id, quantity: 2 },
    ]);
    expect(orderId).toMatch(/^ORD-\d+$/);
    expect(checkoutUrl).toContain(`order=${orderId}`);
    const order = getOrder(orderId);
    expect(order).toBeDefined();
    expect(order?.lines.map((l) => l.id)).toEqual([CATALOG[0].id]);
  });

  it("mints a new id for each order", () => {
    const a = createCheckoutOrder([{ productId: CATALOG[0].id, quantity: 1 }]);
    const b = createCheckoutOrder([{ productId: CATALOG[0].id, quantity: 1 }]);
    expect(a.orderId).not.toBe(b.orderId);
  });
});

describe("checkoutResponse", () => {
  it("returns 404 for an undefined order id", () => {
    const { status, html } = checkoutResponse(undefined);
    expect(status).toBe(404);
    expect(html).toContain("Order not found");
  });

  it("returns 404 for an unknown order id", () => {
    const { status } = checkoutResponse("ORD-does-not-exist");
    expect(status).toBe(404);
  });

  it("renders the order page with line item names, total, and a place-order control", () => {
    const [a, b] = CATALOG;
    const { orderId } = createCheckoutOrder([
      { productId: a.id, quantity: 2 },
      { productId: b.id, quantity: 1 },
    ]);
    const { status, html } = checkoutResponse(orderId);
    expect(status).toBe(200);
    expect(html).toContain(a.name);
    expect(html).toContain(b.name);
    const total = a.price * 2 + b.price;
    expect(html).toContain(
      new Intl.NumberFormat("en-US", { style: "currency", currency: a.currency }).format(total),
    );
    expect(html).toContain("Place order");
    expect(html).toContain(orderId);
  });
});
