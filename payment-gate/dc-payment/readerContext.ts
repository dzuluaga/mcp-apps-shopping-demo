// Stateless carrier for the reader's ephemeral ECDH private key + the bound
// transaction_data between /request and /verify. Sealed as a JWE (dir/A256GCM)
// under a key derived from GATE_SECRET, with a short expiry. Confidentiality
// matters here (it wraps a private key), so we encrypt rather than just HMAC.
import { createHash } from "node:crypto";
import * as jose from "jose";

const DEFAULT_TTL_MS = 180_000;

export interface ReaderContext {
  ecdhPrivateJwk: jose.JWK;
  transactionDataB64: string;
}

interface SealedPayload extends ReaderContext {
  exp: number;
}

function keyFromSecret(secret: string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(secret).digest());
}

export async function sealReaderContext(ctx: ReaderContext, secret: string, ttlMs = DEFAULT_TTL_MS): Promise<string> {
  const payload: SealedPayload = { ...ctx, exp: Date.now() + ttlMs };
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  return await new jose.CompactEncrypt(plaintext)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .encrypt(keyFromSecret(secret));
}

export async function openReaderContext(token: string, secret: string): Promise<ReaderContext> {
  const { plaintext } = await jose.compactDecrypt(token, keyFromSecret(secret));
  const payload = JSON.parse(new TextDecoder().decode(plaintext)) as SealedPayload;
  if (Date.now() > payload.exp) throw new Error("reader context expired");
  return { ecdhPrivateJwk: payload.ecdhPrivateJwk, transactionDataB64: payload.transactionDataB64 };
}
