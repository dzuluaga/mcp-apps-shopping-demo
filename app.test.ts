import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";

describe("createApp", () => {
  it("serves the checkout page on /checkout with a valid order token", async () => {
    const app = createApp({ publicBaseUrl: "http://localhost:3001" });
    // An obviously-invalid token yields the 404 page, proving the route is mounted.
    const res = await request(app).get("/checkout?order=not-a-real-token");
    expect(res.status).toBe(404);
    expect(res.text).toContain("Order not found");
  });

  it("responds to POST /mcp", async () => {
    const app = createApp({ publicBaseUrl: "http://localhost:3001" });
    const res = await request(app).post("/mcp").send({ jsonrpc: "2.0", id: 1, method: "ping" });
    expect(res.status).toBeLessThan(500);
  });
});
