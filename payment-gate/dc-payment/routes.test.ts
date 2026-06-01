import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import * as jose from "jose";
import { createOrder } from "../../catalog.js";
import { encodeOrder } from "../../checkout.js";
import { registerDcPaymentGate } from "./routes.js";

let app: express.Express;
const token = encodeOrder(createOrder([{ productId: "drift-mouse", quantity: 1 }], "ORD-RT01"));

beforeAll(() => {
  process.env.GATE_SECRET = "routes-test-secret";
  app = express();
  registerDcPaymentGate(app);
});

describe("registerDcPaymentGate", () => {
  it("GET /payment-gate/dc-payment renders the page for a valid order", async () => {
    const res = await request(app).get("/payment-gate/dc-payment?order=" + encodeURIComponent(token));
    expect(res.status).toBe(200);
    expect(res.text).toContain("cross-device");
  });

  it("GET /payment-gate/dc-payment 404s for a bad order token", async () => {
    const res = await request(app).get("/payment-gate/dc-payment?order=garbage");
    expect(res.status).toBe(404);
  });

  it("GET /payment-gate/dc-payment/request returns a signed request + reader context", async () => {
    const res = await request(app).get("/payment-gate/dc-payment/request?order=" + encodeURIComponent(token));
    expect(res.status).toBe(200);
    expect(typeof res.body.request).toBe("string");
    expect(typeof res.body.readerContextToken).toBe("string");
    expect((jose.decodeJwt(res.body.request) as any).response_type).toBe("vp_token");
  });

  it("POST /payment-gate/dc-payment/verify 400s on a bad order token", async () => {
    const res = await request(app).post("/payment-gate/dc-payment/verify").send({ orderToken: "garbage", readerContextToken: "x", result: {} });
    expect(res.status).toBe(400);
  });
});
