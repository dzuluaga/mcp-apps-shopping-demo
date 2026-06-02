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
