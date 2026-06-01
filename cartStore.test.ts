import { describe, it, expect } from "vitest";
import { MemoryCartStore, selectCartStore } from "./cartStore.js";

describe("MemoryCartStore", () => {
  it("read returns what was written", async () => {
    const store = new MemoryCartStore();
    await store.write(new Map([["a", 2]]));
    const result = await store.read();
    expect(result.get("a")).toBe(2);
  });

  it("read returns empty map before any write", async () => {
    const store = new MemoryCartStore();
    const result = await store.read();
    expect(result.size).toBe(0);
  });

  it("write replaces prior contents", async () => {
    const store = new MemoryCartStore();
    await store.write(new Map([["a", 1], ["b", 2]]));
    await store.write(new Map([["c", 3]]));
    const result = await store.read();
    expect(result.size).toBe(1);
    expect(result.get("c")).toBe(3);
    expect(result.get("a")).toBeUndefined();
  });

  it("read returns a copy (mutating the returned map doesn't affect the store)", async () => {
    const store = new MemoryCartStore();
    await store.write(new Map([["a", 1]]));
    const m1 = await store.read();
    m1.set("a", 99);
    const m2 = await store.read();
    expect(m2.get("a")).toBe(1);
  });
});

describe("selectCartStore", () => {
  it("returns MemoryCartStore when no env vars", () => {
    const store = selectCartStore({});
    expect(store.constructor.name).toBe("MemoryCartStore");
  });

  it("returns RedisCartStore when KV_REST_API_URL/KV_REST_API_TOKEN present", () => {
    const store = selectCartStore({ KV_REST_API_URL: "https://example.upstash.io", KV_REST_API_TOKEN: "t" } as NodeJS.ProcessEnv);
    expect(store.constructor.name).toBe("RedisCartStore");
  });

  it("returns RedisCartStore when UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN present", () => {
    const store = selectCartStore({ UPSTASH_REDIS_REST_URL: "https://example.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t" } as NodeJS.ProcessEnv);
    expect(store.constructor.name).toBe("RedisCartStore");
  });
});
