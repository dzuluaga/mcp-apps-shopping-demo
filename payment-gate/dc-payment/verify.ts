// Verify the wallet's OpenID4VP presentation: open the sealed reader context,
// decrypt the JWE response, extract the signed transaction_data_hash, assemble
// the DC mandate, and run the gates. Ports the /result half of the spike server.
import * as jose from "jose";
import type { Order } from "../../catalog.js";
import { openReaderContext } from "./readerContext.js";
import { extractTransactionDataHash } from "./mdoc.js";
import { buildDcMandate, runDcGates, type DcMandate, type GateResult } from "./mandate.js";

export interface DcResult {
  protocol?: string;
  data?: unknown;
}

export interface DcVerification {
  mandate: DcMandate;
  gates: GateResult[];
}

export async function verifyDcPresentation(args: {
  order: Order;
  result: DcResult;
  readerContextToken: string;
  secret: string;
}): Promise<DcVerification> {
  const { order, result, readerContextToken, secret } = args;
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
  const mandate = buildDcMandate({ order, vpStr, transactionDataB64: ctx.transactionDataB64, tokenHash });
  const gates = runDcGates(mandate);
  return { mandate, gates };
}
