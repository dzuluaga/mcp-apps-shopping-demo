import { describe, it, expect } from "vitest";
import { CATALOG, priceCart } from "./catalog.js";

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
