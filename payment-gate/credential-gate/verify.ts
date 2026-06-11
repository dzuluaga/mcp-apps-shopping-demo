// Map a wallet's disclosed mdoc claims to a verified boolean.
//
// AGE GATE — fails closed. Requires an explicit positive claim that the holder
// is 21+ (age_over_21 === true, or age_in_years >= 21). It deliberately does NOT
// fall back to "a token was returned": in DCQL, requesting a claim does not
// constrain its value, so a wallet can disclose age_over_21=false and still
// return a decryptable token — token-presence proves nothing about age. We also
// do NOT accept age_over_18, since the gate is 21+ (alcohol).
//
// No cryptographic trust check on the mdoc — matches the dc-payment gate
// (future work).
import * as jose from "jose";
import { decodeVpToken, type DisclosedEntry } from "../dc-payment/mdoc.js";
import { openReaderContext } from "../dc-payment/readerContext.js";
import type { CredentialKind } from "./dcql.js";

export interface GateResult {
  gate: string;
  pass: boolean;
  detail: string;
}

export interface CredGateResult {
  verified: boolean;
  membershipNumber: string | null;
  gates: GateResult[];
}

// Disclosed claim values may be raw or {_tag, value} (sanitized by mdoc.ts).
function claimText(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "object" && "value" in (v as Record<string, unknown>)) {
    return String((v as Record<string, unknown>).value);
  }
  return String(v);
}

function claimTruthy(v: unknown): boolean {
  if (v === true) return true;
  const t = claimText(v);
  return t === "true" || t === "1";
}

function findClaim(disclosed: DisclosedEntry[], elementId: string): unknown {
  for (const entry of disclosed) {
    for (const c of entry.claims) {
      // mdoc.ts labels claims as "<namespace> / <elementId>".
      if (c.label.split(" / ").pop() === elementId) return c.value;
    }
  }
  return undefined;
}

export interface EvaluateOpts {
  // The minimum age the product restriction demands (e.g. 21 for alcohol).
  // Defaults to 21 — the strictest common threshold — when not supplied.
  minimumAge?: number;
}

export function evaluateCredential(
  kind: CredentialKind,
  disclosed: DisclosedEntry[],
  opts: EvaluateOpts = {},
): CredGateResult {
  if (kind === "age") {
    // Require an explicit positive claim that the holder meets the product's
    // minimum age. No token-presence fallback: a returned token does not prove
    // the disclosed value, so an unmet/absent age claim must fail.
    const minimumAge = opts.minimumAge ?? 21;
    const years = claimText(findClaim(disclosed, "age_in_years"));
    const verified =
      (years != null && Number(years) >= minimumAge) ||
      (minimumAge <= 21 && claimTruthy(findClaim(disclosed, "age_over_21"))) ||
      (minimumAge <= 18 && claimTruthy(findClaim(disclosed, "age_over_18")));
    return {
      verified,
      membershipNumber: null,
      gates: [{
        gate: `Age over ${minimumAge}`,
        pass: verified,
        detail: verified ? `verified (>= ${minimumAge})` : `age >= ${minimumAge} not disclosed as true`,
      }],
    };
  }

  // loyalty — require a real, disclosed membership number. A returned token or
  // an unrelated claim must NOT grant the discount: the discount lowers the
  // amount the dc-payment/instant-demo paths bind to, so a forged loyalty state
  // would directly reduce the charge.
  //
  // NOTE: like the rest of this demo, the mdoc issuer/device signature is not
  // cryptographically verified — that hardening is system-wide future work
  // (see payment-gate/dc-payment/mdoc.ts) and would cover age + payment too.
  const membership = claimText(findClaim(disclosed, "membership_number"));
  const verified = membership != null && membership.trim() !== "";
  return {
    verified,
    membershipNumber: verified ? membership : null,
    gates: [{
      gate: "Loyalty membership",
      pass: verified,
      detail: verified ? `member ${membership}` : "no membership number disclosed",
    }],
  };
}

// Decrypt the wallet's JWE response, decode the vp_token, and evaluate. Mirrors
// dc-payment/verify.ts but without payment binding. Returns verified + gates.
export async function verifyCredentialPresentation(args: {
  kind: CredentialKind;
  result: { protocol?: string; data?: unknown };
  readerContextToken: string;
  secret: string;
  // Required minimum age for this order's products (age gate only).
  minimumAge?: number;
}): Promise<CredGateResult> {
  const { kind, result, readerContextToken, secret, minimumAge } = args;
  const ctx = await openReaderContext(readerContextToken, secret);

  let data: unknown = result?.data;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { /* leave as string */ }
  }
  const jwe: string | undefined = (data as { response?: string } | undefined)?.response;
  if (!jwe) throw new Error("no .response (JWE) in result.data");

  const encPrivKey = await jose.importJWK(ctx.ecdhPrivateJwk, "ECDH-ES");
  const { plaintext } = await jose.compactDecrypt(jwe, encPrivKey);
  const openid4vpResponse = JSON.parse(new TextDecoder().decode(plaintext)) as { vp_token?: unknown };
  const vpToken = openid4vpResponse.vp_token;
  const disclosed = vpToken ? decodeVpToken(vpToken) : [];
  return evaluateCredential(kind, disclosed, { minimumAge });
}
