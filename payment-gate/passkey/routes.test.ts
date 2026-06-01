import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";
import { encodeOrder } from "../../checkout.js";
import { createOrder } from "../../catalog.js";

function appWithOrderToken() {
  const app = createApp({ publicBaseUrl: "http://localhost:3001" });
  const order = createOrder([{ productId: "drift-mouse", quantity: 1 }], "ORD-RT01");
  return { app, token: encodeOrder(order) };
}

describe("passkey gate routes", () => {
  it("GET /payment-gate/passkey renders the page with the amount", async () => {
    const { app, token } = appWithOrderToken();
    const res = await request(app).get(`/payment-gate/passkey?order=${token}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("Authorize payment");
    expect(res.text).toContain("ORD-RT01");
  });

  it("GET /payment-gate/passkey with a bad order token → 404 page", async () => {
    const app = createApp({ publicBaseUrl: "http://localhost:3001" });
    const res = await request(app).get("/payment-gate/passkey?order=garbage");
    expect(res.status).toBe(404);
  });

  it("GET /payment-gate/passkey with a decodable token but bad currency → 404 (not 500)", async () => {
    const app = createApp({ publicBaseUrl: "http://localhost:3001" });
    const order = createOrder([{ productId: "drift-mouse", quantity: 1 }], "ORD-RT02");
    const token = encodeOrder({ ...order, currency: "NOPE", lines: order.lines.map((l) => ({ ...l, currency: "NOPE" })) });
    const res = await request(app).get(`/payment-gate/passkey?order=${token}`);
    expect(res.status).toBe(404);
  });

  it("GET /payment-gate/passkey/options returns options + a challenge token", async () => {
    const { app } = appWithOrderToken();
    const res = await request(app).get("/payment-gate/passkey/options");
    expect(res.status).toBe(200);
    expect(res.body.options.challenge).toBeTruthy();
    expect(typeof res.body.challengeToken).toBe("string");
  });

  it("POST /payment-gate/passkey/verify with a bad challenge token → 400", async () => {
    const { app, token } = appWithOrderToken();
    const res = await request(app)
      .post("/payment-gate/passkey/verify")
      .send({ response: {}, challengeToken: "bad.bad.bad", orderToken: token });
    expect(res.status).toBe(400);
  });

  it("serves the @simplewebauthn/browser ESM at the same-origin static path", async () => {
    const { app } = appWithOrderToken();
    const res = await request(app).get("/payment-gate/lib/sw/index.js");
    expect(res.status).toBe(200);
    expect(res.text).toContain("startRegistration");
  });
});
