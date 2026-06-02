import { describe, it, expect } from "vitest";
import { decodeVpToken, extractTransactionDataHash, inspectAuthBlocks } from "./mdoc.js";
import { buildVpToken } from "./fixtures.js";

const hashBytes = new Uint8Array(32).fill(7);

describe("mdoc structural decode", () => {
  it("extracts the deviceSigned transaction_data_hash as base64url", () => {
    const vp = buildVpToken({ txHashBytes: hashBytes });
    expect(extractTransactionDataHash(vp)).toBe(Buffer.from(hashBytes).toString("base64url"));
  });

  it("returns null when the hash is absent", () => {
    expect(extractTransactionDataHash(buildVpToken({ txHashBytes: hashBytes, omitHash: true }))).toBeNull();
  });

  it("reports issuerAuth + deviceAuth presence", () => {
    const present = inspectAuthBlocks(buildVpToken({ txHashBytes: hashBytes }));
    expect(present.hasIssuerAuth).toBe(true);
    expect(present.hasDeviceAuth).toBe(true);
    const stripped = inspectAuthBlocks(buildVpToken({ txHashBytes: hashBytes, omitDeviceAuth: true }));
    expect(stripped.hasDeviceAuth).toBe(false);
  });

  it("flattens disclosed issuerSigned claims", () => {
    const disclosed = decodeVpToken({ dpc: buildVpToken({ txHashBytes: hashBytes, instrumentId: "pi-XYZ" }) });
    const labels = Object.fromEntries(disclosed[0].claims.map((c) => [c.label.split(" / ").pop(), c.value]));
    expect(labels["payment_instrument_id"]).toBe("pi-XYZ");
  });
});
