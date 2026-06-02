import { describe, it, expect } from "vitest";
import { MemoryOrderStore, selectOrderStore, RedisOrderStore, type CompletedOrder } from "./orderStore.js";

const sample: CompletedOrder = {
  orderId: "ORD-AB12",
  mandateId: "mandate_pm_123",
  amount: 69,
  currency: "USD",
  method: "dc-payment",
  instrument: { issuer: "Demo Bank", maskedAccount: "•••• 4242", holder: "Ada L." },
  gates: [{ gate: "Amount binding", pass: true, detail: "ok" }],
  completedAt: "2026-06-01T00:00:00.000Z",
};

describe("MemoryOrderStore", () => {
  it("returns null before anything is written", async () => {
    const store = new MemoryOrderStore();
    expect(await store.read()).toBeNull();
  });

  it("round-trips a completed order", async () => {
    const store = new MemoryOrderStore();
    await store.write(sample);
    expect(await store.read()).toEqual(sample);
  });

  it("clear() forgets the order", async () => {
    const store = new MemoryOrderStore();
    await store.write(sample);
    await store.clear();
    expect(await store.read()).toBeNull();
  });
});

describe("selectOrderStore", () => {
  it("falls back to memory without Redis credentials", () => {
    expect(selectOrderStore({} as NodeJS.ProcessEnv)).toBeInstanceOf(MemoryOrderStore);
  });

  it("uses Redis when KV credentials are present", () => {
    const store = selectOrderStore({ KV_REST_API_URL: "https://example.upstash.io", KV_REST_API_TOKEN: "t" } as NodeJS.ProcessEnv);
    expect(store).toBeInstanceOf(RedisOrderStore);
  });
});
