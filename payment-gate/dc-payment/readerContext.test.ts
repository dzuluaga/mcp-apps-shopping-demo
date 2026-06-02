import { describe, it, expect } from "vitest";
import { sealReaderContext, openReaderContext } from "./readerContext.js";

const secret = "test-gate-secret";
const ctx = { ecdhPrivateJwk: { kty: "EC", crv: "P-256", d: "x", x: "y", z: "z" }, transactionDataB64: "dHhkYXRh" };

describe("readerContext seal/open", () => {
  it("round-trips the ECDH key and transaction_data", async () => {
    const token = await sealReaderContext(ctx, secret);
    const opened = await openReaderContext(token, secret);
    expect(opened.transactionDataB64).toBe(ctx.transactionDataB64);
    expect(opened.ecdhPrivateJwk).toEqual(ctx.ecdhPrivateJwk);
  });

  it("rejects a token sealed under a different secret", async () => {
    const token = await sealReaderContext(ctx, secret);
    await expect(openReaderContext(token, "wrong-secret")).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    const token = await sealReaderContext(ctx, secret, -1000);
    await expect(openReaderContext(token, secret)).rejects.toThrow(/expired/);
  });
});
