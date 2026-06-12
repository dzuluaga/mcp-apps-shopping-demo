import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { qrPngBase64 } from "./qr.js";

const app = () => createApp({ publicBaseUrl: "http://localhost:3001" });

describe("GET /payment-gate/qr", () => {
  it("renders an SVG QR for a HashScan URL", async () => {
    const data = "https://hashscan.io/testnet/transaction/0.0.7162784%401781195398.389184445";
    const res = await request(app()).get(`/payment-gate/qr?data=${encodeURIComponent(data)}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/svg+xml");
    // supertest buffers non-text content types into res.body.
    expect(Buffer.from(res.body).toString()).toContain("<svg");
  });

  it("refuses non-HashScan data — not a general-purpose QR service", async () => {
    const res = await request(app()).get(`/payment-gate/qr?data=${encodeURIComponent("https://evil.example/phish")}`);
    expect(res.status).toBe(400);
  });

  it("refuses lookalike prefixes (hashscan.io.evil.example)", async () => {
    const res = await request(app()).get(
      `/payment-gate/qr?data=${encodeURIComponent("https://hashscan.io.evil.example/x")}`,
    );
    expect(res.status).toBe(400);
  });

  it("refuses a missing data param", async () => {
    const res = await request(app()).get("/payment-gate/qr");
    expect(res.status).toBe(400);
  });
});

describe("qrPngBase64", () => {
  it("renders base64 PNG bytes for MCP image content blocks", async () => {
    const b64 = await qrPngBase64("https://hashscan.io/testnet/transaction/x");
    expect(b64).toMatch(/^iVBOR/); // PNG magic, base64-encoded
    expect(b64).not.toContain("data:"); // raw base64, no data-URI prefix
  });
});
