import { describe, it, expect } from "vitest";
import { createOrder } from "../../catalog.js";
import { buildTransactionData, encodeTransactionData, hashTransactionData } from "./txData.js";
import { buildVpToken } from "./fixtures.js";
import { extractDcEvidence } from "./mandate.js";

const origin = { rpID: "localhost", origin: "http://localhost:3030" };

// extractDcEvidence does the dc-specific crypto the sidecar can't: re-derives the
// wallet-signed transaction_data_hash and re-checks amount/currency/payee. The
// AP2 mandate envelope + gates are tested in the Python sidecar suite.
function evidenceFor(opts: { instrumentId?: string; omitDeviceAuth?: boolean; expiry?: string } = {}) {
  const order = createOrder([{ productId: "drift-mouse", quantity: 1 }], "ORD-MD01");
  const txDataB64 = encodeTransactionData(buildTransactionData(order, origin));
  const tokenHash = hashTransactionData(txDataB64);
  const hashBytes = new Uint8Array(Buffer.from(tokenHash, "base64url"));
  const vpStr = buildVpToken({ txHashBytes: hashBytes, instrumentId: opts.instrumentId ?? "pi-77AABBCC", omitDeviceAuth: opts.omitDeviceAuth, expiry: opts.expiry });
  return { order, txDataB64, tokenHash, vpStr };
}

describe("extractDcEvidence", () => {
  it("binds the amount and surfaces the disclosed instrument for a consistent presentation", () => {
    const { order, txDataB64, tokenHash, vpStr } = evidenceFor();
    const ev = extractDcEvidence({ order, origin, vpStr, transactionDataB64: txDataB64, tokenHash });
    expect(ev.type).toBe("openid4vp-dc-api");
    expect(ev.amountBound).toBe(true);
    expect(ev.authBlocksPresent).toBe(true);
    expect(ev.instrumentId).toBe("pi-77AABBCC");
    expect(ev.transactionDataHash).toBe(tokenHash);
  });

  it("amountBound is false when the cart total is tampered", () => {
    const { order, txDataB64, tokenHash, vpStr } = evidenceFor();
    const ev = extractDcEvidence({ order: { ...order, total: 99999 }, origin, vpStr, transactionDataB64: txDataB64, tokenHash });
    expect(ev.amountBound).toBe(false);
  });

  it("amountBound is false when the payee RP does not match", () => {
    const { order, txDataB64, tokenHash, vpStr } = evidenceFor();
    const ev = extractDcEvidence({ order, origin: { rpID: "evil.example", origin: "https://evil.example" }, vpStr, transactionDataB64: txDataB64, tokenHash });
    expect(ev.amountBound).toBe(false);
  });

  it("amountBound is false when the wallet-signed hash does not match", () => {
    const { order, txDataB64, vpStr } = evidenceFor();
    const ev = extractDcEvidence({ order, origin, vpStr, transactionDataB64: txDataB64, tokenHash: hashTransactionData("different") });
    expect(ev.amountBound).toBe(false);
  });

  it("flags missing deviceAuth", () => {
    const { order, txDataB64, tokenHash, vpStr } = evidenceFor({ omitDeviceAuth: true });
    const ev = extractDcEvidence({ order, origin, vpStr, transactionDataB64: txDataB64, tokenHash });
    expect(ev.hasDeviceAuth).toBe(false);
    expect(ev.authBlocksPresent).toBe(false);
  });

  it("surfaces the disclosed expiry date", () => {
    const { order, txDataB64, tokenHash, vpStr } = evidenceFor({ expiry: "2020-01-01" });
    const ev = extractDcEvidence({ order, origin, vpStr, transactionDataB64: txDataB64, tokenHash });
    expect(ev.credentialExpiry).toBe("2020-01-01");
  });
});
