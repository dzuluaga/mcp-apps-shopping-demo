import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import * as jose from "jose";
import { createOrder } from "../../catalog.js";
import { encodeOrder } from "../../checkout.js";
import { cartStore } from "../../cartStore.js";
import { orderStore } from "../../orderStore.js";
import { buildTransactionData, encodeTransactionData, hashTransactionData } from "./txData.js";
import { sealReaderContext } from "./readerContext.js";
import { buildVpToken, encryptToReaderKey } from "./fixtures.js";
import { registerDcPaymentGate } from "./routes.js";

let app: express.Express;
const order = createOrder([{ productId: "drift-mouse", quantity: 1 }], "ORD-RT01");
const token = encodeOrder(order);

beforeAll(() => {
  process.env.GATE_SECRET = "routes-test-secret";
  app = express();
  registerDcPaymentGate(app);
});

// A wallet response whose signed hash matches the amount bound to this order +
// the request RP (rpID "localhost", set via the Host header below).
async function passingVerifyBody() {
  const localhost = { rpID: "localhost", origin: "http://localhost" };
  const txDataB64 = encodeTransactionData(buildTransactionData(order, localhost));
  const hashBytes = new Uint8Array(Buffer.from(hashTransactionData(txDataB64), "base64url"));
  const vpStr = buildVpToken({ txHashBytes: hashBytes });
  const enc = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const ecdhPrivateJwk = await crypto.subtle.exportKey("jwk", enc.privateKey);
  const readerContextToken = await sealReaderContext({ ecdhPrivateJwk, transactionDataB64: txDataB64 }, "routes-test-secret");
  const jwe = await encryptToReaderKey(vpStr, ecdhPrivateJwk);
  return { orderToken: token, readerContextToken, result: { protocol: "openid4vp", data: { response: jwe } } };
}

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

  it("POST /verify on a passing presentation completes the order and clears the cart", async () => {
    await cartStore.write(new Map([["drift-mouse", 1]]));
    await orderStore.clear();
    const body = await passingVerifyBody();
    const res = await request(app).post("/payment-gate/dc-payment/verify").set("Host", "localhost").send(body);
    expect(res.status).toBe(200);
    expect(res.body.completed).toBe(true);
    expect(res.body.gates.every((g: { pass: boolean }) => g.pass)).toBe(true);

    const recorded = await orderStore.read();
    expect(recorded?.orderId).toBe("ORD-RT01");
    expect(recorded?.mandateId).toBe(res.body.mandate.id);
    expect((await cartStore.read()).size).toBe(0);
  });
});
