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
    expect(html).toContain("Authorize payment");
    expect(html).toContain(orderId);
  });
});

describe("checkout page authorization affordance", () => {
  it("offers a primary Authorize payment link to the passkey gate and keeps the instant mock Place order button", () => {
    const order = createOrder([{ productId: "drift-mouse", quantity: 1 }], "ORD-CO01");
    const { status, html } = checkoutResponse(encodeOrder(order));
    expect(status).toBe(200);
    expect(html).toContain("/payment-gate/passkey?order=");
    expect(html).toContain("Authorize payment");
    expect(html).toContain("Place order");
  });

  it("offers a secondary cross-device link to the DC payment gate", () => {
    const order = createOrder([{ productId: "drift-mouse", quantity: 1 }], "ORD-CO02");
    const { html } = checkoutResponse(encodeOrder(order));
    expect(html).toContain("/payment-gate/dc-payment?order=");
    expect(html).toContain("cross-device");
  });
});

describe("checkout page loyalty (end of flow)", () => {
  it("offers an Apply loyalty discount link when loyalty is not yet applied", () => {
    const order = createOrder([{ productId: CATALOG[0].id, quantity: 2 }], "ORD-DISC02");
    const { html } = checkoutResponse(encodeOrder(order), { loyaltyApplied: false });
    expect(html).toContain("/credential-gate/loyalty?order=");
    expect(html).toContain("Apply loyalty discount");
  });

  it("shows the discount line and total once loyalty is applied", () => {
    const order = createOrder([{ productId: CATALOG[0].id, quantity: 2 }], "ORD-DISC03");
    const { html } = checkoutResponse(encodeOrder(order), { loyaltyApplied: true });
    expect(html).toContain("Loyalty discount");
    expect(html).toMatch(/-\s*\$/); // negative discount amount rendered
  });
});

describe("checkout page age gating (end of flow)", () => {
  const alcohol = CATALOG.find((p) => p.minimumAge != null)!;

  it("locks payment and offers a Verify age link when alcohol is unverified", () => {
    const order = createOrder([{ productId: alcohol.id, quantity: 1 }], "ORD-AGE01");
    const { html } = checkoutResponse(encodeOrder(order), { ageVerified: false });
    expect(html).toContain("/credential-gate/age?order=");
    expect(html).toContain("Verify age");
    expect(html).toContain("Payment is locked");
    expect(html).not.toContain("/payment-gate/passkey?order=");
  });

  it("unlocks payment once age is verified", () => {
    const order = createOrder([{ productId: alcohol.id, quantity: 1 }], "ORD-AGE02");
    const { html } = checkoutResponse(encodeOrder(order), { ageVerified: true });
    expect(html).toContain("Age verified");
    expect(html).toContain("/payment-gate/passkey?order=");
    expect(html).not.toContain("Payment is locked");
  });

  it("does not gate a cart without alcohol", () => {
    const order = createOrder([{ productId: "drift-mouse", quantity: 1 }], "ORD-AGE03");
    const { html } = checkoutResponse(encodeOrder(order));
    expect(html).not.toContain("Verify age");
    expect(html).toContain("/payment-gate/passkey?order=");
  });
});
