// Build the signed OpenID4VP request for navigator.credentials.get({digital}).
// Ports the request half of the spike's server.js. The reader cert SAN + client_id
// are derived from the request host so it works on localhost and Vercel HTTPS.
import * as jose from "jose";
import * as x509 from "@peculiar/x509";
import type { Order } from "../../catalog.js";
import type { Origin } from "../origin.js";
import { buildTransactionData, encodeTransactionData } from "./txData.js";
import { sealReaderContext } from "./readerContext.js";

const webcrypto = globalThis.crypto;
x509.cryptoProvider.set(webcrypto);

const SIGN_ALG = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" } as const;

async function makeReaderCert(rpID: string): Promise<{ x5c: string; privateKey: CryptoKey }> {
  const keys = await webcrypto.subtle.generateKey(SIGN_ALG, true, ["sign", "verify"]);
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: "01",
    name: `CN=${rpID}`,
    notBefore: new Date(Date.now() - 60_000),
    notAfter: new Date(Date.now() + 86_400_000),
    signingAlgorithm: SIGN_ALG,
    keys,
    extensions: [
      new x509.SubjectAlternativeNameExtension([{ type: "dns", value: rpID }]),
      // The Subject Key Identifier extension is REQUIRED — without it the wallet's
      // TrustManagerUtil does subjectKeyIdentifier!! → NPE.
      await x509.SubjectKeyIdentifierExtension.create(keys.publicKey),
    ],
  });
  return { x5c: cert.toString("base64"), privateKey: keys.privateKey };
}

export interface SignedRequest {
  request: string;
  readerContextToken: string;
}

export async function buildSignedRequest(order: Order, origin: Origin, secret: string): Promise<SignedRequest> {
  const { x5c, privateKey } = await makeReaderCert(origin.rpID);

  // Ephemeral P-256 key the wallet encrypts its response to.
  const encKP = await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const encPubJwk = await webcrypto.subtle.exportKey("jwk", encKP.publicKey);
  const ecdhPrivateJwk = (await webcrypto.subtle.exportKey("jwk", encKP.privateKey)) as jose.JWK;
  const encJwk = { kty: "EC", crv: "P-256", x: encPubJwk.x, y: encPubJwk.y, use: "enc", alg: "ECDH-ES", kid: "response-encryption-key" };

  const txDataB64 = encodeTransactionData(buildTransactionData(order, origin));
  const nonce = jose.base64url.encode(webcrypto.getRandomValues(new Uint8Array(16)));

  const requestObject = {
    response_type: "vp_token",
    response_mode: "dc_api.jwt",
    client_id: `x509_san_dns:${origin.rpID}`,
    expected_origins: [origin.origin],
    nonce,
    dcql_query: {
      credentials: [{
        id: "dpc",
        format: "mso_mdoc",
        meta: { doctype_value: "org.multipaz.payment.sca.1" },
        claims: [
          { path: ["org.multipaz.payment.sca.1", "issuer_name"], intent_to_retain: false },
          { path: ["org.multipaz.payment.sca.1", "payment_instrument_id"], intent_to_retain: false },
          { path: ["org.multipaz.payment.sca.1", "masked_account_reference"], intent_to_retain: false },
          { path: ["org.multipaz.payment.sca.1", "holder_name"], intent_to_retain: false },
          { path: ["org.multipaz.payment.sca.1", "issue_date"], intent_to_retain: false },
          { path: ["org.multipaz.payment.sca.1", "expiry_date"], intent_to_retain: false },
        ],
      }],
    },
    client_metadata: {
      vp_formats_supported: { mso_mdoc: { issuerauth_alg_values: [-7], deviceauth_alg_values: [-7] } },
      jwks: { keys: [encJwk] },
    },
    transaction_data: [txDataB64],
  };

  const request = await new jose.SignJWT(requestObject)
    .setProtectedHeader({ alg: "ES256", typ: "oauth-authz-req+jwt", x5c: [x5c] })
    .setIssuedAt()
    .sign(privateKey as unknown as jose.CryptoKey);

  const readerContextToken = await sealReaderContext({ ecdhPrivateJwk, transactionDataB64: txDataB64 }, secret);
  return { request, readerContextToken };
}
