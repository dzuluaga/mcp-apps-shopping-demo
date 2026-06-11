import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import { orderStore } from "./orderStore.js";
import { cartStore } from "./cartStore.js";
import { createCheckoutOrder } from "./checkout.js";
import { RESOURCE_URI, SKYBRIDGE_URI } from "./server.js";

describe("createApp", () => {
  it("serves the checkout page on /checkout with a valid order token", async () => {
    const app = createApp({ publicBaseUrl: "http://localhost:3001" });
    // An obviously-invalid token yields the 404 page, proving the route is mounted.
    const res = await request(app).get("/checkout?order=not-a-real-token");
    expect(res.status).toBe(404);
    expect(res.text).toContain("Order not found");
  });

  it("GET /checkout/order-status reports incomplete when no matching order", async () => {
    const app = createApp({ publicBaseUrl: "http://localhost:3001" });
    await orderStore.clear();
    const res = await request(app).get("/checkout/order-status?orderId=ORD-NONE");
    expect(res.status).toBe(200);
    expect(res.body.completed).toBe(false);
    expect(res.body.order).toBeNull();
  });

  it("GET /checkout/order-status returns the order once it matches the orderId", async () => {
    const app = createApp({ publicBaseUrl: "http://localhost:3001" });
    await orderStore.write({
      orderId: "ORD-APP01",
      mandateId: "mandate_pm_test",
      amount: 49,
      currency: "USD",
      method: "passkey",
      instrument: { issuer: "stripe_test", maskedAccount: "pi_test", holder: null },
      gates: [{ gate: "Amount integrity", pass: true, detail: "ok" }],
      completedAt: new Date().toISOString(),
    });
    const match = await request(app).get("/checkout/order-status?orderId=ORD-APP01");
    expect(match.body.completed).toBe(true);
    expect(match.body.order.orderId).toBe("ORD-APP01");
    // A different orderId must not match the stored order.
    const miss = await request(app).get("/checkout/order-status?orderId=ORD-OTHER");
    expect(miss.body.completed).toBe(false);
    await orderStore.clear();
  });

  it("POST /checkout/place-order completes the order (instant demo) and clears the cart", async () => {
    const app = createApp({ publicBaseUrl: "http://localhost:3001" });
    await orderStore.clear();
    await cartStore.write(new Map([["aurora-headphones", 1]]));

    const { orderId, checkoutUrl } = createCheckoutOrder([
      { productId: "aurora-headphones", quantity: 1 },
    ]);
    const token = new URL(checkoutUrl).searchParams.get("order")!;

    const placed = await request(app).post("/checkout/place-order").send({ order: token });
    expect(placed.status).toBe(200);
    expect(placed.body.ok).toBe(true);
    expect(placed.body.orderId).toBe(orderId);

    // The order-status poll the widget runs now reports completion for this id.
    const status = await request(app).get(`/checkout/order-status?orderId=${orderId}`);
    expect(status.body.completed).toBe(true);
    expect(status.body.order.orderId).toBe(orderId);
    expect(status.body.order.amount).toBe(199);
    expect(status.body.order.method).toBe("instant-demo");

    // And the cart was cleared, so the agent can list the fresh catalog after.
    const cart = await cartStore.read();
    expect(cart.size).toBe(0);
    await orderStore.clear();
  });

  it("POST /checkout/place-order rejects a missing or invalid order token", async () => {
    const app = createApp({ publicBaseUrl: "http://localhost:3001" });
    const res = await request(app).post("/checkout/place-order").send({ order: "garbage" });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it("responds to POST /mcp", async () => {
    const app = createApp({ publicBaseUrl: "http://localhost:3001" });
    const res = await request(app).post("/mcp").send({ jsonrpc: "2.0", id: 1, method: "ping" });
    expect(res.status).toBeLessThan(500);
  });

  it("UI resource allowlists the checkout origin in CSP connectDomains so the widget poll isn't blocked", async () => {
    const app = createApp({ publicBaseUrl: "http://localhost:3001" });
    const res = await request(app)
      .post("/mcp")
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/read",
        params: { uri: RESOURCE_URI },
      });
    const line = res.text.split("\n").find((l) => l.startsWith("data: "))!;
    const result = JSON.parse(line.slice("data: ".length)).result;
    const csp = result.contents[0]._meta.ui.csp;
    expect(csp.connectDomains).toContain("http://localhost:3001");
  });

  it("skybridge resource allowlists the checkout origin in widgetCSP connect_domains so the ChatGPT widget poll isn't blocked", async () => {
    const app = createApp({ publicBaseUrl: "http://localhost:3001" });
    const res = await request(app)
      .post("/mcp")
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/read",
        params: { uri: SKYBRIDGE_URI },
      });
    const line = res.text.split("\n").find((l) => l.startsWith("data: "))!;
    const result = JSON.parse(line.slice("data: ".length)).result;
    const csp = result.contents[0]._meta["openai/widgetCSP"];
    expect(csp.connect_domains).toContain("http://localhost:3001");
  });
});

import { encodeOrder } from "./checkout.js";
import { createOrder } from "./catalog.js";

const ALCOHOL = "celebration-champagne";

function orderToken(id: string, productId = ALCOHOL): string {
  return encodeOrder(createOrder([{ productId, quantity: 1 }], id));
}
const co = (token: string) => `/checkout?order=${encodeURIComponent(token)}`;

describe("credential gate wiring", () => {
  it("serves the age gate page", async () => {
    const app = createApp({ publicBaseUrl: "http://localhost:3001" });
    const res = await request(app).get("/credential-gate/age");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Verify your age");
  });

  it("404s an unknown gate kind", async () => {
    const app = createApp({ publicBaseUrl: "http://localhost:3001" });
    const res = await request(app).get("/credential-gate/bogus");
    expect(res.status).toBe(404);
  });

  it("rejects a demo verify with no order", async () => {
    const app = createApp({ publicBaseUrl: "http://localhost:3001" });
    const res = await request(app).post("/credential-gate/age/demo").send({});
    expect(res.status).toBe(400);
  });

  it("instant-demo age verify unlocks payment for THAT order only (no cross-order bleed)", async () => {
    const app = createApp({ publicBaseUrl: "http://localhost:3001" });
    const tokenA = orderToken("ORD-A");
    const tokenB = orderToken("ORD-B");
    expect((await request(app).get(co(tokenA))).text).toContain("Payment is locked");

    const demo = await request(app).post("/credential-gate/age/demo").send({ order: tokenA });
    expect(demo.body.verified).toBe(true);

    const afterA = await request(app).get(co(tokenA));
    expect(afterA.text).toContain("Age verified");
    expect(afterA.text).not.toContain("Payment is locked");

    // Order B must remain gated — verification is scoped to order A.
    expect((await request(app).get(co(tokenB))).text).toContain("Payment is locked");
  });

  it("instant-demo loyalty applies the discount for that order", async () => {
    const app = createApp({ publicBaseUrl: "http://localhost:3001" });
    const token = orderToken("ORD-LOY", "aurora-headphones"); // non-alcohol: no age gate
    await request(app).post("/credential-gate/loyalty/demo").send({ order: token });
    expect((await request(app).get(co(token))).text).toContain("Loyalty discount");
  });
});

describe("server-side age gate (place-order)", () => {
  it("rejects place-order for an age-restricted order with no age verification (403)", async () => {
    const app = createApp({ publicBaseUrl: "http://localhost:3001" });
    const token = orderToken("ORD-BYPASS"); // champagne, never age-verified
    const res = await request(app).post("/checkout/place-order").send({ order: token });
    expect(res.status).toBe(403);
    // The order must not have been recorded.
    const status = await request(app).get(`/checkout/order-status?orderId=ORD-BYPASS`);
    expect(status.body.completed).toBe(false);
  });

  it("allows place-order once the order is age-verified", async () => {
    const app = createApp({ publicBaseUrl: "http://localhost:3001" });
    const token = orderToken("ORD-OK");
    await request(app).post("/credential-gate/age/demo").send({ order: token });
    const res = await request(app).post("/checkout/place-order").send({ order: token });
    expect(res.body.ok).toBe(true);
  });

  it("allows place-order for a non-age-restricted order without verification", async () => {
    const app = createApp({ publicBaseUrl: "http://localhost:3001" });
    const token = orderToken("ORD-PLAIN", "aurora-headphones");
    const res = await request(app).post("/checkout/place-order").send({ order: token });
    expect(res.body.ok).toBe(true);
  });
});

describe("checkout resets verification", () => {
  it("place-order clears that order's verification", async () => {
    const app = createApp({ publicBaseUrl: "http://localhost:3001" });
    const token = orderToken("ORD-RESET1");
    await request(app).post("/credential-gate/age/demo").send({ order: token });
    expect((await request(app).get(co(token))).text).toContain("Age verified");

    const placed = await request(app).post("/checkout/place-order").send({ order: token });
    expect(placed.body.ok).toBe(true);

    // Re-gated after completion.
    expect((await request(app).get(co(token))).text).toContain("Payment is locked");
  });
});
