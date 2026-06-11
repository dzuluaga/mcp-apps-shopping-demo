import { describe, it, expect } from "vitest";
import { CATALOG, createOrder, getProduct, getReviews, priceCart, LOYALTY_DISCOUNT_PCT } from "./catalog.js";

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

  it("records an ISO createdAt", () => {
    const order = createOrder([{ productId: CATALOG[0].id, quantity: 1 }], "ORD-X");
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

describe("getProduct", () => {
  it("returns the product for a known id", () => {
    const p = CATALOG[0];
    expect(getProduct(p.id)).toBe(p);
  });

  it("returns undefined for an unknown id", () => {
    expect(getProduct("nope")).toBeUndefined();
  });
});

describe("getReviews", () => {
  it("returns a non-empty review list for every catalog product", () => {
    for (const p of CATALOG) {
      const reviews = getReviews(p.id);
      expect(reviews.length).toBeGreaterThan(0);
      for (const r of reviews) {
        expect(r.author).toBeTruthy();
        expect(r.rating).toBeGreaterThanOrEqual(1);
        expect(r.rating).toBeLessThanOrEqual(5);
        expect(r.title).toBeTruthy();
        expect(r.body).toBeTruthy();
      }
    }
  });

  it("returns an empty array for an unknown id", () => {
    expect(getReviews("nope")).toEqual([]);
  });
});

describe("age-restricted catalog", () => {
  it("has at least one age-restricted product", () => {
    expect(CATALOG.some((p) => p.minimumAge != null)).toBe(true);
  });
});

describe("priceCart discount + flags", () => {
  const alcohol = CATALOG.find((p) => p.minimumAge != null)!;
  const normal = CATALOG.find((p) => p.minimumAge == null)!;

  it("sets hasAgeRestricted when an alcohol item is in the cart", () => {
    const cart = priceCart([{ productId: alcohol.id, quantity: 1 }]);
    expect(cart.hasAgeRestricted).toBe(true);
    const clean = priceCart([{ productId: normal.id, quantity: 1 }]);
    expect(clean.hasAgeRestricted).toBe(false);
  });

  it("applies a 10% whole-cart discount when loyaltyApplied", () => {
    const cart = priceCart([{ productId: normal.id, quantity: 2 }], { loyaltyApplied: true });
    expect(cart.subtotal).toBe(normal.price * 2);
    expect(cart.discount).toBe(Math.round(normal.price * 2 * (LOYALTY_DISCOUNT_PCT / 100) * 100) / 100);
    expect(cart.total).toBe(cart.subtotal - cart.discount);
    expect(cart.loyaltyApplied).toBe(true);
  });

  it("no discount without loyalty; total equals subtotal", () => {
    const cart = priceCart([{ productId: normal.id, quantity: 1 }]);
    expect(cart.discount).toBe(0);
    expect(cart.total).toBe(cart.subtotal);
    expect(cart.loyaltyApplied).toBe(false);
    expect(cart.ageVerified).toBe(false);
  });

  it("reflects ageVerified from opts", () => {
    const cart = priceCart([{ productId: alcohol.id, quantity: 1 }], { ageVerified: true });
    expect(cart.ageVerified).toBe(true);
  });
});

describe("createOrder discount", () => {
  it("snapshots discount + subtotal", () => {
    const normal = CATALOG.find((p) => p.minimumAge == null)!;
    const order = createOrder([{ productId: normal.id, quantity: 2 }], "ORD-DISC01", { loyaltyApplied: true });
    expect(order.subtotal).toBe(normal.price * 2);
    expect(order.discount).toBeGreaterThan(0);
    expect(order.total).toBe(order.subtotal - order.discount);
  });
});
