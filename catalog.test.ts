import { describe, it, expect } from "vitest";
import { CATALOG, createOrder, priceCart } from "./catalog.js";

describe("CATALOG", () => {
  it("has products with required fields", () => {
    expect(CATALOG.length).toBeGreaterThan(0);
    for (const p of CATALOG) {
      expect(p.id).toBeTruthy();
      expect(p.name).toBeTruthy();
      expect(typeof p.price).toBe("number");
      expect(p.currency).toBeTruthy();
    }
  });

  it("has unique ids", () => {
    const ids = CATALOG.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("priceCart", () => {
  it("returns an empty cart for no items", () => {
    const cart = priceCart([]);
    expect(cart.lines).toEqual([]);
    expect(cart.itemCount).toBe(0);
    expect(cart.total).toBe(0);
    expect(cart.unknownIds).toEqual([]);
  });

  it("multiplies unit price by quantity", () => {
    const p = CATALOG[0];
    const cart = priceCart([{ productId: p.id, quantity: 3 }]);
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]).toMatchObject({
      id: p.id,
      unitPrice: p.price,
      quantity: 3,
      lineTotal: p.price * 3,
    });
    expect(cart.itemCount).toBe(3);
    expect(cart.total).toBeCloseTo(p.price * 3, 2);
  });

  it("sums multiple lines in order", () => {
    const [a, b] = CATALOG;
    const cart = priceCart([
      { productId: a.id, quantity: 2 },
      { productId: b.id, quantity: 1 },
    ]);
    expect(cart.lines.map((l) => l.id)).toEqual([a.id, b.id]);
    expect(cart.itemCount).toBe(3);
    expect(cart.total).toBeCloseTo(a.price * 2 + b.price, 2);
  });

  it("records unknown ids and skips them", () => {
    const known = CATALOG[0];
    const cart = priceCart([
      { productId: known.id, quantity: 1 },
      { productId: "nope", quantity: 5 },
    ]);
    expect(cart.lines.map((l) => l.id)).toEqual([known.id]);
    expect(cart.unknownIds).toEqual(["nope"]);
  });

  it("skips non-positive quantities", () => {
    const known = CATALOG[0];
    const cart = priceCart([
      { productId: known.id, quantity: 0 },
      { productId: known.id, quantity: -2 },
    ]);
    expect(cart.lines).toEqual([]);
    expect(cart.itemCount).toBe(0);
    expect(cart.total).toBe(0);
  });
});

describe("createOrder", () => {
  it("builds an order from priced cart items", () => {
    const [a, b] = CATALOG;
    const order = createOrder(
      [
        { productId: a.id, quantity: 2 },
        { productId: b.id, quantity: 1 },
      ],
      "ORD-TEST",
    );
    expect(order.id).toBe("ORD-TEST");
    expect(order.lines.map((l) => l.id)).toEqual([a.id, b.id]);
    expect(order.itemCount).toBe(3);
    expect(order.total).toBeCloseTo(a.price * 2 + b.price, 2);
    expect(order.currency).toBe(a.currency);
  });

  it("uses the passed-in id verbatim", () => {
    const order = createOrder([{ productId: CATALOG[0].id, quantity: 1 }], "ORD-1042");
    expect(order.id).toBe("ORD-1042");
  });

  it('sets status to "placed" and an ISO createdAt', () => {
    const order = createOrder([{ productId: CATALOG[0].id, quantity: 1 }], "ORD-X");
    expect(order.status).toBe("placed");
    expect(() => new Date(order.createdAt).toISOString()).not.toThrow();
    expect(new Date(order.createdAt).toISOString()).toBe(order.createdAt);
  });

  it("drops unknown ids from lines (no unknownIds field on Order)", () => {
    const known = CATALOG[0];
    const order = createOrder(
      [
        { productId: known.id, quantity: 1 },
        { productId: "nope", quantity: 5 },
      ],
      "ORD-Y",
    );
    expect(order.lines.map((l) => l.id)).toEqual([known.id]);
    expect("unknownIds" in order).toBe(false);
  });

  it("yields an empty zero-total order for an empty cart", () => {
    const order = createOrder([], "ORD-EMPTY");
    expect(order.lines).toEqual([]);
    expect(order.itemCount).toBe(0);
    expect(order.total).toBe(0);
  });
});
