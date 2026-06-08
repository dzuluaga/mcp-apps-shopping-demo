// DC device evidence extraction. The AP2 SD-JWT mandate + gates now live in the
// sidecar (ap2Client.ts); this module performs the dc-specific cryptographic
// work the sidecar CAN'T (it never sees the vp_token): re-deriving the
// wallet-signed transaction_data_hash and re-checking that the signed amount,
// currency, and payee match this order + RP. The result is attested to the
// sidecar via `risk_data` (amountBound, authBlocks, expiry, instrument).
import type { Order } from "../../catalog.js";
import type { Origin } from "../origin.js";
import { decodeVpToken, inspectAuthBlocks } from "./mdoc.js";
import { hashTransactionData, decodeTransactionData } from "./txData.js";

// The evidence object handed to the sidecar as the mandate's `authorization`.
export interface DcEvidence {
  type: "openid4vp-dc-api";
  instrumentId: string | null;
  issuerName: string | null;
  maskedAccount: string | null;
  holderName: string | null;
  credentialExpiry: string | null;
  transactionDataHash: string | null;
  authBlocksPresent: boolean;
  hasIssuerAuth: boolean;
  hasDeviceAuth: boolean;
  // True only if the wallet-signed hash equals SHA-256 of the transaction_data
  // we sent AND that data's amount/currency/payee match the order + this RP.
  amountBound: boolean;
  bindingDetail: string;
}

// Disclosed mdoc claim values can be {_tag, value} (e.g. tag-1004 dates) or raw.
function claimText(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "object" && "value" in (v as Record<string, unknown>)) {
    return String((v as Record<string, unknown>).value);
  }
  return String(v);
}

function disclosedClaims(vpStr: string): Record<string, unknown> {
  const disclosed = decodeVpToken({ dpc: vpStr });
  return Object.fromEntries((disclosed[0]?.claims ?? []).map((c) => [c.label.split(" / ").pop()!, c.value]));
}

export function extractDcEvidence(args: {
  order: Order;
  origin: Origin;
  vpStr: string;
  transactionDataB64: string;
  tokenHash: string | null;
}): DcEvidence {
  const { order, origin, vpStr, transactionDataB64, tokenHash } = args;
  const claims = disclosedClaims(vpStr);

  // Re-derive the amount binding (the old runDcGates Gate 1) here in TS.
  const recomputed = transactionDataB64 ? hashTransactionData(transactionDataB64) : null;
  const txd = transactionDataB64 ? decodeTransactionData(transactionDataB64) : undefined;
  const hashOk = !!tokenHash && tokenHash === recomputed;
  const amountOk = Number(txd?.payload?.amount) === Number(order.total);
  const currencyOk = txd?.payload?.currency === order.currency;
  const payeeOk = !!txd?.payload?.payee?.id && txd.payload.payee.id === origin.rpID;

  const auth = inspectAuthBlocks(vpStr);

  return {
    type: "openid4vp-dc-api",
    instrumentId: claimText(claims["payment_instrument_id"]),
    issuerName: claimText(claims["issuer_name"]),
    maskedAccount: claimText(claims["masked_account_reference"]),
    holderName: claimText(claims["holder_name"]),
    credentialExpiry: claimText(claims["expiry_date"]),
    transactionDataHash: tokenHash,
    authBlocksPresent: auth.hasIssuerAuth && auth.hasDeviceAuth,
    hasIssuerAuth: auth.hasIssuerAuth,
    hasDeviceAuth: auth.hasDeviceAuth,
    amountBound: hashOk && amountOk && currencyOk && payeeOk,
    bindingDetail:
      `hash ${hashOk ? "✓" : "✗"} (token=${tokenHash}) · ` +
      `amount ${amountOk ? "✓" : "✗"} (${txd?.payload?.amount} vs ${order.total}) · ` +
      `currency ${currencyOk ? "✓" : "✗"} (${txd?.payload?.currency} vs ${order.currency}) · ` +
      `payee ${payeeOk ? "✓" : "✗"} (${txd?.payload?.payee?.id} vs ${origin.rpID})`,
  };
}
