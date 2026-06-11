import { describe, it, expect } from "vitest";
import { MemoryVerificationStore } from "./verificationStore.js";

describe("MemoryVerificationStore (per-order)", () => {
  it("defaults to unverified for an unknown order", async () => {
    const s = new MemoryVerificationStore();
    const v = await s.read("ORD-1");
    expect(v.ageVerified).toBe(false);
    expect(v.loyalty.applied).toBe(false);
    expect(v.loyalty.membershipNumber).toBeNull();
  });

  it("merges partial writes within one order", async () => {
    const s = new MemoryVerificationStore();
    await s.write("ORD-1", { ageVerified: true });
    expect((await s.read("ORD-1")).ageVerified).toBe(true);
    await s.write("ORD-1", { loyalty: { applied: true, membershipNumber: "LM-123" } });
    const v = await s.read("ORD-1");
    expect(v.ageVerified).toBe(true);
    expect(v.loyalty).toEqual({ applied: true, membershipNumber: "LM-123" });
  });

  it("does NOT bleed verification across orders", async () => {
    const s = new MemoryVerificationStore();
    await s.write("ORD-1", { ageVerified: true });
    expect((await s.read("ORD-1")).ageVerified).toBe(true);
    // A different order must stay unverified.
    expect((await s.read("ORD-2")).ageVerified).toBe(false);
  });

  it("clear resets a single order only", async () => {
    const s = new MemoryVerificationStore();
    await s.write("ORD-1", { ageVerified: true });
    await s.write("ORD-2", { ageVerified: true });
    await s.clear("ORD-1");
    expect((await s.read("ORD-1")).ageVerified).toBe(false);
    expect((await s.read("ORD-2")).ageVerified).toBe(true);
  });
});
