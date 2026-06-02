import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import { decodeOrder } from "./checkout.js";
import { cartStore } from "./cartStore.js";

function rpcResult(text: string): any {
  const line = text.split("\n").find((l) => l.startsWith("data: "))!;
  return JSON.parse(line.slice("data: ".length)).result;
}
async function callTool(app: any, name: string, args: Record<string, unknown> = {}) {
  const res = await request(app)
    .post("/mcp")
    .set("Accept", "application/json, text/event-stream")
    .send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  return rpcResult(res.text);
}

describe("checkout with widget-supplied items", () => {
  it("builds the correct order from items even when the server cart is EMPTY", async () => {
    const app = createApp({ publicBaseUrl: "http://localhost:3001" });
    await cartStore.write(new Map()); // server cart intentionally empty

    const result = await callTool(app, "checkout", { items: [{ productId: "aurora-headphones", quantity: 1 }] });
    const payload = JSON.parse(result.content.find((b: any) => b.type === "text").text);
    expect(payload.orderId).toMatch(/^ORD-/);

    const order = decodeOrder(new URL(payload.checkoutUrl).searchParams.get("order")!)!;
    expect(order.itemCount).toBe(1);
    expect(order.total).toBe(199);
    expect(order.lines[0].name).toBe("Aurora Wireless Headphones");

    // And it reconciled the server cart.
    const cart = await cartStore.read();
    expect(cart.get("aurora-headphones")).toBe(1);
    await cartStore.write(new Map());
  });
});
