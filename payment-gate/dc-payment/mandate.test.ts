import { describe, it, expect } from "vitest";
import { createOrder, type Order } from "../../catalog.js";
import { buildTransactionData, encodeTransactionData, hashTransactionData } from "./txData.js";
import { buildVpToken } from "./fixtures.js";
import { buildDcMandate, runDcGates } from "./mandate.js";

const origin = { rpID: "localhost", origin: "http://localhost:3030" };

function consistent(): { mandate: ReturnType<typeof buildDcMandate>; order: Order; txDataB64: string } {
  const order = createOrder([{ productId: "drift-mouse", quantity: 1 }], "ORD-MD01");
  const txDataB64 = encodeTransactionData(buildTransactionData(order, origin));
  const hashBytes = new Uint8Array(Buffer.from(hashTransactionData(txDataB64), "base64url"));
  const vpStr = buildVpToken({ txHashBytes: hashBytes, instrumentId: "pi-77AABBCC" });
  const mandate = buildDcMandate({ order, vpStr, transactionDataB64: txDataB64, tokenHash: hashTransactionData(txDataB64) });
  return { mandate, order, txDataB64 };
}

const pass = (rs: { gate: string; pass: boolean }[], g: string) => rs.find((r) => r.gate === g)?.pass;

describe("buildDcMandate", () => {
  it("produces a 0.1-dc mandate with the wallet hash in userAuthorization", () => {
    const { mandate, txDataB64 } = consistent();
    expect(mandate.type).toBe("ap2.PaymentMandate");
    expect(mandate.version).toBe("0.1-dc");
    expect(mandate.userAuthorization.type).toBe("openid4vp-dc-api");
    expect(mandate.userAuthorization.transactionData).toBe(txDataB64);
    expect(mandate.subject.credentialId).toBe("pi-77AABBCC");
  });
});

describe("runDcGates", () => {
  it("passes all four gates for a consistent mandate", () => {
    const rs = runDcGates(consistent().mandate, origin);
    expect(rs).toHaveLength(4);
    expect(rs.every((r) => r.pass)).toBe(true);
  });

  it("Gate 1 fails when the cart total is tampered", () => {
    const { mandate } = consistent();
    mandate.cart.total = 99999;
    const rs = runDcGates(mandate, origin);
    expect(pass(rs, "Amount binding")).toBe(false);
    expect(pass(rs, "Subject binding")).toBe(true);
  });

  it("Gate 1 fails when the cart currency is swapped at an equal amount", () => {
    const { mandate } = consistent();
    mandate.cart.currency = "EUR";
    const rs = runDcGates(mandate, origin);
    expect(pass(rs, "Amount binding")).toBe(false);
  });

  it("Gate 1 fails when the payee does not match this RP", () => {
    const { mandate } = consistent();
    const rs = runDcGates(mandate, { rpID: "evil.example", origin: "https://evil.example" });
    expect(pass(rs, "Amount binding")).toBe(false);
  });

  it("Gate 2 fails when deviceAuth is stripped from the token", () => {
    const { order, txDataB64 } = consistent();
    const hashBytes = new Uint8Array(Buffer.from(hashTransactionData(txDataB64), "base64url"));
    const vpStr = buildVpToken({ txHashBytes: hashBytes, omitDeviceAuth: true });
    const mandate = buildDcMandate({ order, vpStr, transactionDataB64: txDataB64, tokenHash: hashTransactionData(txDataB64) });
    const rs = runDcGates(mandate, origin);
    expect(pass(rs, "Authorization present")).toBe(false);
    expect(pass(rs, "Amount binding")).toBe(true);
  });

  it("Gate 3 fails when the credential is expired", () => {
    const { order, txDataB64 } = consistent();
    const hashBytes = new Uint8Array(Buffer.from(hashTransactionData(txDataB64), "base64url"));
    const vpStr = buildVpToken({ txHashBytes: hashBytes, expiry: "2020-01-01" });
    const mandate = buildDcMandate({ order, vpStr, transactionDataB64: txDataB64, tokenHash: hashTransactionData(txDataB64) });
    expect(pass(runDcGates(mandate, origin), "Credential not expired")).toBe(false);
  });

  it("Gate 4 fails when the subject does not match the disclosed instrument", () => {
    const { mandate } = consistent();
    mandate.subject.credentialId = "pi-DIFFERENT";
    expect(pass(runDcGates(mandate, origin), "Subject binding")).toBe(false);
  });
});
