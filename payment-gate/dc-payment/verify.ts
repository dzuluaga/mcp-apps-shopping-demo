// Verify the wallet's OpenID4VP presentation: open the sealed reader context,
// decrypt the JWE response, extract the signed transaction_data_hash, and
// extract the dc device evidence (amount binding, auth blocks, instrument).
// The AP2 mandate envelope + gates are then produced by the sidecar from this
// evidence (see dc-payment/routes.ts).
import * as jose from "jose";
import type { Order } from "../../catalog.js";
import type { Origin } from "../origin.js";
import { openReaderContext } from "./readerContext.js";
import { extractTransactionDataHash } from "./mdoc.js";
import { extractDcEvidence, type DcEvidence } from "./mandate.js";

export interface DcResult {
  protocol?: string;
  data?: unknown;
}

export async function verifyDcPresentation(args: {
  order: Order;
  origin: Origin;
  result: DcResult;
  readerContextToken: string;
  secret: string;
}): Promise<DcEvidence> {
  const { order, origin, result, readerContextToken, secret } = args;
  const ctx = await openReaderContext(readerContextToken, secret);

  let data: any = result?.data;
  if (typeof data === "string") data = JSON.parse(data);
  const jwe: string | undefined = data?.response;
  if (!jwe) throw new Error("no .response (JWE) in result.data");

  const encPrivKey = await jose.importJWK(ctx.ecdhPrivateJwk, "ECDH-ES");
  const { plaintext } = await jose.compactDecrypt(jwe, encPrivKey);
  const openid4vpResponse = JSON.parse(new TextDecoder().decode(plaintext));
  const vpToken = openid4vpResponse.vp_token; // { dpc: [ "<DeviceResponse b64url>" ] }
  const vpStr: string = Array.isArray(vpToken?.dpc) ? vpToken.dpc[0] : vpToken?.dpc;
  if (!vpStr) throw new Error("no vp_token.dpc in decrypted response");

  const tokenHash = extractTransactionDataHash(vpStr);
  return extractDcEvidence({ order, origin, vpStr, transactionDataB64: ctx.transactionDataB64, tokenHash });
}
