// Test-only: build a base64url mdoc DeviceResponse with a transaction_data_hash
// in deviceSigned, mirroring the spike's test/fixtures.mjs. Used by mdoc/mandate/
// verify tests so we exercise the decode + gates without a live wallet.
import { encode, Tag } from "cbor-x";
import * as jose from "jose";

export interface VpTokenOpts {
  txHashBytes: Uint8Array;
  instrumentId?: string;
  expiry?: string;
  omitDeviceAuth?: boolean;
  omitHash?: boolean;
}

export function buildVpToken(opts: VpTokenOpts): string {
  const { txHashBytes, instrumentId = "pi-77AABBCC", expiry = "2028-09-01", omitDeviceAuth = false, omitHash = false } = opts;
  const isi = (digestID: number, el: string, val: unknown) =>
    new Tag(encode({ digestID, random: new Uint8Array(8), elementIdentifier: el, elementValue: val }), 24);
  const devMap = omitHash ? {} : { "urn:eudi:sca:payment:1": { transaction_data_hash: txHashBytes } };
  const doc = {
    docType: "org.multipaz.payment.sca.1",
    issuerSigned: {
      nameSpaces: {
        "org.multipaz.payment.sca.1": [
          isi(5, "payment_instrument_id", instrumentId),
          isi(2, "expiry_date", new Tag(expiry, 1004)),
        ],
      },
      issuerAuth: ["a", "b", "c", "d"],
    },
    deviceSigned: {
      nameSpaces: new Tag(encode(devMap), 24),
      ...(omitDeviceAuth ? {} : { deviceAuth: { deviceSignature: ["a", null, null, new Uint8Array(64)] } }),
    },
  };
  return Buffer.from(encode({ version: "1.0", status: 0, documents: [doc] })).toString("base64url");
}

// Encrypt an OpenID4VP response { vp_token: { dpc: [vpStr] } } to the reader's
// ephemeral public key, mirroring what the wallet sends back. The reader context
// stores the PRIVATE jwk; we derive the public jwk from it to encrypt.
export async function encryptToReaderKey(vpStr: string, ecdhPrivateJwk: jose.JWK): Promise<string> {
  const { d, ...publicJwk } = ecdhPrivateJwk;
  const pub = await jose.importJWK({ ...publicJwk, alg: "ECDH-ES" }, "ECDH-ES");
  const plaintext = new TextEncoder().encode(JSON.stringify({ vp_token: { dpc: [vpStr] } }));
  return await new jose.CompactEncrypt(plaintext)
    .setProtectedHeader({ alg: "ECDH-ES", enc: "A256GCM" })
    .encrypt(pub);
}
