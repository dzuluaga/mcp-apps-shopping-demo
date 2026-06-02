// Single source of truth for the OpenID4VP transaction_data entry. Amount +
// payee come from the order + origin (via the shared buildBindingFields), so the
// hash the wallet signs is derived from the same fields Gate 1 re-checks.
import { createHash, randomUUID } from "node:crypto";
import * as jose from "jose";
import type { Order } from "../../catalog.js";
import type { Origin } from "../origin.js";
import { buildBindingFields } from "../mandate.js";

export interface TransactionData {
  type: "urn:eudi:sca:payment:1";
  credential_ids: string[];
  payload: {
    transaction_id: string;
    amount: number;
    currency: string;
    payee: { id: string; name: string };
  };
}

export function buildTransactionData(order: Order, origin: Origin): TransactionData {
  const b = buildBindingFields(order, origin);
  return {
    type: "urn:eudi:sca:payment:1",
    credential_ids: ["dpc"],
    payload: {
      transaction_id: randomUUID(),
      amount: b.amount,
      currency: b.currency,
      payee: b.payee,
    },
  };
}

export function encodeTransactionData(txData: TransactionData): string {
  return jose.base64url.encode(new TextEncoder().encode(JSON.stringify(txData)));
}

// SHA-256 of the base64url transaction_data string, itself base64url. This is the
// value the wallet signs over (transaction_data_hash) and Gate 1 re-derives.
export function hashTransactionData(txDataB64: string): string {
  return createHash("sha256").update(txDataB64).digest("base64url");
}

export function decodeTransactionData(txDataB64: string): TransactionData {
  return JSON.parse(Buffer.from(txDataB64, "base64url").toString("utf8")) as TransactionData;
}
