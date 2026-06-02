// AP2-shaped DC payment mandate + four deterministic gates. Ports
// mandate-wrapper.js + validate.js. No MOCK-DEV-SIGNER: the proof is the
// wallet-signed transaction_data_hash. Gate 1 re-derives the hash from the
// mandate's own transactionData and re-checks amount + payee — never trusting a
// `verified` flag.
import { randomUUID } from "node:crypto";
import type { Order } from "../../catalog.js";
import type { Origin } from "../origin.js";
import { decodeVpToken, extractTransactionDataHash, inspectAuthBlocks } from "./mdoc.js";
import { hashTransactionData, decodeTransactionData } from "./txData.js";

export interface DcInstrument {
  issuer: string | null;
  instrumentId: string | null;
  maskedAccount: string | null;
  holder: string | null;
  expiry: string | null;
}

export interface DcMandate {
  type: "ap2.PaymentMandate";
  version: "0.1-dc";
  id: string;
  issuedAt: string;
  expiresAt: string;
  issuer: string;
  subject: { credentialId: string | null };
  cart: Order;
  payment: { instrument: DcInstrument; amount: number; currency: string };
  userAuthorization: {
    type: "openid4vp-dc-api";
    transactionData: string;
    transactionDataHash: string | null;
    vpToken: string;
    verified: boolean;
  };
}

// Disclosed mdoc claim values can be {_tag, value} (e.g. tag-1004 dates) or raw.
function claimText(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "object" && "value" in (v as any)) return String((v as any).value);
  return String(v);
}

function disclosedClaims(vpStr: string): Record<string, unknown> {
  const disclosed = decodeVpToken({ dpc: vpStr });
  return Object.fromEntries((disclosed[0]?.claims ?? []).map((c) => [c.label.split(" / ").pop()!, c.value]));
}

export function buildDcMandate(args: {
  order: Order;
  vpStr: string;
  transactionDataB64: string;
  tokenHash: string | null;
}): DcMandate {
  const { order, vpStr, transactionDataB64, tokenHash } = args;
  const now = new Date();
  const expires = new Date(now.getTime() + 5 * 60_000);
  const claims = disclosedClaims(vpStr);
  const expectedHash = hashTransactionData(transactionDataB64);
  const instrument: DcInstrument = {
    issuer: claimText(claims["issuer_name"]),
    instrumentId: claimText(claims["payment_instrument_id"]),
    maskedAccount: claimText(claims["masked_account_reference"]),
    holder: claimText(claims["holder_name"]),
    expiry: claimText(claims["expiry_date"]),
  };
  return {
    type: "ap2.PaymentMandate",
    version: "0.1-dc",
    id: "mandate_pm_" + randomUUID(),
    issuedAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    issuer: "did:web:product-picker.local",
    subject: { credentialId: instrument.instrumentId },
    cart: order,
    payment: { instrument, amount: order.total, currency: order.currency },
    userAuthorization: {
      type: "openid4vp-dc-api",
      transactionData: transactionDataB64,
      transactionDataHash: tokenHash,
      vpToken: vpStr,
      verified: !!tokenHash && tokenHash === expectedHash,
    },
  };
}

export interface GateResult {
  gate: string;
  pass: boolean;
  detail: string;
}

export function runDcGates(mandate: DcMandate, origin: Origin): GateResult[] {
  const ua = mandate.userAuthorization;
  const cart = mandate.cart;
  const results: GateResult[] = [];

  // Gate 1 — amount binding: (a) the wallet-signed hash equals SHA-256 of the
  // transaction_data we sent, (b) that transaction_data's amount, currency, and
  // payee match the cart + this RP. Re-derived here; the stored `verified` flag
  // is NOT trusted.
  const tokenHash = ua.vpToken ? extractTransactionDataHash(ua.vpToken) : null;
  const recomputed = ua.transactionData ? hashTransactionData(ua.transactionData) : null;
  const txd = ua.transactionData ? decodeTransactionData(ua.transactionData) : undefined;
  const hashOk = !!tokenHash && tokenHash === recomputed;
  const amountOk = Number(txd?.payload?.amount) === Number(cart.total);
  const currencyOk = txd?.payload?.currency === cart.currency;
  const payeeOk = !!txd?.payload?.payee?.id && txd.payload.payee.id === origin.rpID;
  results.push({
    gate: "Amount binding",
    pass: hashOk && amountOk && currencyOk && payeeOk,
    detail: `hash ${hashOk ? "✓" : "✗"} (token=${tokenHash}) · amount ${amountOk ? "✓" : "✗"} (${txd?.payload?.amount} vs ${cart.total}) · currency ${currencyOk ? "✓" : "✗"} (${txd?.payload?.currency} vs ${cart.currency}) · payee ${payeeOk ? "✓" : "✗"} (${txd?.payload?.payee?.id} vs ${origin.rpID})`,
  });

  // Gate 2 — authorization present & structurally valid (issuerAuth + deviceAuth).
  const auth = ua.vpToken ? inspectAuthBlocks(ua.vpToken) : { hasIssuerAuth: false, hasDeviceAuth: false, docType: null };
  results.push({
    gate: "Authorization present",
    pass: auth.hasIssuerAuth && auth.hasDeviceAuth,
    detail: `issuerAuth ${auth.hasIssuerAuth ? "✓" : "✗"} · deviceAuth ${auth.hasDeviceAuth ? "✓" : "✗"}`,
  });

  // Gate 3 — credential not expired (disclosed expiry_date in the future).
  const claims = ua.vpToken ? disclosedClaims(ua.vpToken) : {};
  const expStr = claimText(claims["expiry_date"]);
  const notExpired = !!expStr && new Date(expStr).getTime() > Date.now();
  results.push({ gate: "Credential not expired", pass: notExpired, detail: `expiry_date=${expStr}` });

  // Gate 4 — subject binding: mandate.subject re-derived from the disclosed instrument id.
  const instrumentId = claimText(claims["payment_instrument_id"]);
  const subjectOk = !!instrumentId && mandate.subject.credentialId === instrumentId;
  results.push({ gate: "Subject binding", pass: subjectOk, detail: `subject=${mandate.subject.credentialId} · instrument=${instrumentId}` });

  return results;
}
