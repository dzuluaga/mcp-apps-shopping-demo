// Stateless WebAuthn challenge. The challenge rides in a signed token:
//   base64url(challenge) "." expiryMs "." base64url(HMAC-SHA256(challenge|expiry))
// so issue and verify need no shared server memory (serverless-correct on Vercel).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const DEFAULT_TTL_MS = 120_000;

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function sign(challenge: string, expiry: number, secret: string): string {
  return createHmac("sha256", secret).update(`${challenge}|${expiry}`).digest("base64url");
}

export function issueChallenge(secret: string, ttlMs = DEFAULT_TTL_MS): { challenge: string; token: string } {
  const challenge = b64url(randomBytes(32));
  const expiry = Date.now() + ttlMs;
  const sig = sign(challenge, expiry, secret);
  return { challenge, token: `${challenge}.${expiry}.${sig}` };
}

export function verifyChallenge(token: string, secret: string): string {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed challenge token");
  const [challenge, expiryStr, sig] = parts;
  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry)) throw new Error("malformed challenge token");
  const expected = sign(challenge, expiry, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("bad challenge signature");
  if (Date.now() > expiry) throw new Error("challenge expired");
  return challenge;
}

// GATE_SECRET from env; dev falls back to a per-process random value (fine because
// a single process spans issue+verify locally).
let cached: string | undefined;
export function gateSecret(): string {
  if (cached) return cached;
  cached = process.env.GATE_SECRET ?? randomBytes(32).toString("hex");
  return cached;
}
