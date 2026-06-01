import { describe, it, expect } from "vitest";
import { CATALOG, createOrder } from "./catalog.js";
import {
  createCheckoutOrder,
  encodeOrder,
  decodeOrder,
  checkoutResponse,
} from "./checkout.js";

describe("encodeOrder / decodeOrder", () => {
  it("round-trips an order", () => {
    const order = createOrder([{ productId: CATALOG[0].id, quantity: 2 }], "ORD-ABC123");
    const decoded = decodeOrder(encodeOrder(order));
    expect(decoded).toEqual(order);
  });

  it("returns undefined for a non-decodable token", () => {
    expect(decodeOrder("not-a-real-token")).toBeUndefined();
  });
});

describe("createCheckoutOrder", () => {
  it("returns an ORD- id and a checkout URL whose token decodes to the order", () => {
    const { orderId, checkoutUrl } = createCheckoutOrder([
      { productId: CATALOG[0].id, quantity: 2 },
    ]);
    expect(orderId).toMatch(/^ORD-[0-9A-F]{6}$/);
    const token = new URL(checkoutUrl).searchParams.get("order");
    expect(token).toBeTruthy();
    const order = decodeOrder(token!);
    expect(order?.id).toBe(orderId);
    expect(order?.lines.map((l) => l.id)).toEqual([CATALOG[0].id]);
  });

  it("mints a new id for each order", () => {
    const a = createCheckoutOrder([{ productId: CATALOG[0].id, quantity: 1 }]);
    const b = createCheckoutOrder([{ productId: CATALOG[0].id, quantity: 1 }]);
    expect(a.orderId).not.toBe(b.orderId);
  });
});

describe("checkoutResponse", () => {
  it("returns 404 for an undefined token", () => {
    const { status, html } = checkoutResponse(undefined);
    expect(status).toBe(404);
    expect(html).toContain("Order not found");
  });

  it("returns 404 for an undecodable token", () => {
    const { status } = checkoutResponse("garbage-token");
    expect(status).toBe(404);
  });

  it("returns 404 for a decodable token that fails to render (bad currency)", () => {
    // Passes decodeOrder's shape check (id/lines/currency are present and typed)
    // but the currency code is invalid, so Intl.NumberFormat throws on render.
    const malformed = {
      id: "ORD-BADCUR",
      lines: [{ id: "x", name: "Widget", unitPrice: 1, currency: "NOTACUR", quantity: 1, lineTotal: 1 }],
      itemCount: 1,
      total: 1,
      currency: "NOTACUR",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const token = Buffer.from(JSON.stringify(malformed), "utf8").toString("base64url");
    const { status } = checkoutResponse(token);
    expect(status).toBe(404);
  });

  it("renders the order page from an encoded token", () => {
    const [a, b] = CATALOG;
    const { checkoutUrl, orderId } = createCheckoutOrder([
      { productId: a.id, quantity: 2 },
      { productId: b.id, quantity: 1 },
    ]);
    const token = new URL(checkoutUrl).searchParams.get("order")!;
    const { status, html } = checkoutResponse(token);
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
