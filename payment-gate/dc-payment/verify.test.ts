import { describe, it, expect } from "vitest";
import { createOrder } from "../../catalog.js";
import { buildTransactionData, encodeTransactionData, hashTransactionData } from "./txData.js";
import { sealReaderContext } from "./readerContext.js";
import { buildVpToken, encryptToReaderKey } from "./fixtures.js";
import { verifyDcPresentation } from "./verify.js";

const secret = "test-gate-secret";
const origin = { rpID: "localhost", origin: "http://localhost:3030" };

async function setup(opts: { tamperToken?: boolean } = {}) {
  const order = createOrder([{ productId: "drift-mouse", quantity: 1 }], "ORD-VF01");
  const txDataB64 = encodeTransactionData(buildTransactionData(order, origin));
  const expected = hashTransactionData(txDataB64);
  const hashBytes = new Uint8Array(Buffer.from(opts.tamperToken ? hashTransactionData("different") : expected, "base64url"));
  const vpStr = buildVpToken({ txHashBytes: hashBytes });
  // Reader keypair: seal the private jwk, encrypt the wallet response to its public half.
  const enc = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const ecdhPrivateJwk = await crypto.subtle.exportKey("jwk", enc.privateKey);
  const readerContextToken = await sealReaderContext({ ecdhPrivateJwk, transactionDataB64: txDataB64 }, secret);
  const jwe = await encryptToReaderKey(vpStr, ecdhPrivateJwk);
  return { order, readerContextToken, result: { protocol: "openid4vp", data: { response: jwe } } };
}

describe("verifyDcPresentation", () => {
  it("decrypts, assembles a mandate, and passes the gates for a matching hash", async () => {
    const { order, readerContextToken, result } = await setup();
    const { mandate, gates } = await verifyDcPresentation({ order, result, readerContextToken, secret });
    expect(mandate.userAuthorization.verified).toBe(true);
    expect(gates.find((g) => g.gate === "Amount binding")?.pass).toBe(true);
  });

  it("marks the amount-binding gate failed when the signed hash does not match", async () => {
    const { order, readerContextToken, result } = await setup({ tamperToken: true });
    const { gates } = await verifyDcPresentation({ order, result, readerContextToken, secret });
    expect(gates.find((g) => g.gate === "Amount binding")?.pass).toBe(false);
  });

  it("throws on a reader context sealed under a different secret", async () => {
    const { order, readerContextToken, result } = await setup();
    await expect(verifyDcPresentation({ order, result, readerContextToken, secret: "wrong" })).rejects.toThrow();
  });
});
