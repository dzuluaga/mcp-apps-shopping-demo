// Signed OpenID4VP request for a credential (age / loyalty) gate. Like
// dc-payment/request.ts but with NO transaction_data — age/loyalty is not a
// payment, so there's no amount to bind. Reuses the reader cert + encryption key
// helpers from the payment gate, and seals an empty txData into the reader
// context (verify.ts ignores it for credential gates).
import * as jose from "jose";
import type { Origin } from "../origin.js";
import { makeReaderCert, makeEncryptionKey } from "../dc-payment/request.js";
import { sealReaderContext } from "../dc-payment/readerContext.js";
import { buildCredentialDcql, type CredentialKind } from "./dcql.js";

export interface SignedRequest {
  request: string;
  readerContextToken: string;
}

export async function buildCredentialRequest(
  kind: CredentialKind,
  origin: Origin,
  secret: string,
): Promise<SignedRequest> {
  const { x5c, privateKey } = await makeReaderCert(origin.rpID);
  const { encJwk, ecdhPrivateJwk } = await makeEncryptionKey();
  const nonce = jose.base64url.encode(crypto.getRandomValues(new Uint8Array(16)));

  const requestObject = {
    response_type: "vp_token",
    response_mode: "dc_api.jwt",
    client_id: `x509_san_dns:${origin.rpID}`,
    expected_origins: [origin.origin],
    nonce,
    dcql_query: buildCredentialDcql(kind),
    client_metadata: {
      vp_formats_supported: { mso_mdoc: { issuerauth_alg_values: [-7], deviceauth_alg_values: [-7] } },
      jwks: { keys: [encJwk] },
    },
  };

  const request = await new jose.SignJWT(requestObject)
    .setProtectedHeader({ alg: "ES256", typ: "oauth-authz-req+jwt", x5c: [x5c] })
    .setIssuedAt()
    .sign(privateKey as unknown as jose.KeyLike);

  const readerContextToken = await sealReaderContext({ ecdhPrivateJwk, transactionDataB64: "" }, secret);
  return { request, readerContextToken };
}
