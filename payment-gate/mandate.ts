// Binding fields + AP2-shaped passkey mandate + the four deterministic gates.
// Ports the technique from ucp-agentic-tester/spike/passkey-gate/mandate-wrapper.js,
// adapted to this repo's Order. No gate trusts a `verified` boolean — each is
// re-derived from the mandate's own fields.
import { createHash, randomUUID } from "node:crypto";
import type { Order } from "../catalog.js";
import type { Origin } from "./origin.js";

const PAYEE_NAME = "Product Picker Demo";

export interface BindingFields {
  amount: number;
  currency: string;
  payee: { id: string; name: string };
  orderId: string;
}

export function buildBindingFields(order: Order, origin: Origin): BindingFields {
  return {
    amount: order.total,
    currency: order.currency,
    payee: { id: origin.rpID, name: PAYEE_NAME },
    orderId: order.id,
  };
}

// Minimal shape of what @simplewebauthn returns that we carry into the mandate.
export interface VerifiedAuthenticator {
  credentialID: string;
  userVerified: boolean;
  credentialDeviceType: "singleDevice" | "multiDevice";
  credentialBackedUp: boolean;
}

export interface PasskeyMandate {
  type: "ap2.PaymentMandate";
  version: "0.1-mock";
  id: string;
  issuedAt: string;
  expiresAt: string;
  issuer: string;
  subject: { credentialID: string };
  cart: Order;
  payment: { instrument: string; instrumentReference: string; network: string; amount: number; currency: string };
  userAuthorization: {
    type: "webauthn.assertion";
    credentialID: string;
    userVerified: boolean;
    hardwareBacked: boolean;
    deviceType: string;
    backedUp: boolean;
    rpID: string;
    origin: string;
    ceremonyTimestamp: string;
  };
  payeeId: string;
  signature: { alg: "MOCK-DEV-SIGNER"; value: string; note: string };
}

export function buildPasskeyMandate(args: {
  order: Order;
  authenticator: VerifiedAuthenticator;
  origin: Origin;
}): PasskeyMandate {
  const { order, authenticator, origin } = args;
  const now = new Date();
  const expires = new Date(now.getTime() + 5 * 60_000);
  const binding = buildBindingFields(order, origin);

  const body = {
    type: "ap2.PaymentMandate" as const,
    version: "0.1-mock" as const,
    id: "mandate_pm_" + randomUUID(),
    issuedAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    issuer: "did:web:product-picker.local",
    subject: { credentialID: authenticator.credentialID },
    cart: order,
    payment: {
      instrument: "stripe_test",
      instrumentReference: "pi_3Mock" + Math.random().toString(36).slice(2, 10).toUpperCase(),
      network: "card",
      amount: binding.amount,
      currency: binding.currency,
    },
    userAuthorization: {
      type: "webauthn.assertion" as const,
      credentialID: authenticator.credentialID,
      userVerified: authenticator.userVerified,
      // A single-device credential is bound to this authenticator's hardware; a
      // multi-device (syncable) passkey is not strictly hardware-bound.
      hardwareBacked: authenticator.credentialDeviceType === "singleDevice",
      deviceType: authenticator.credentialDeviceType,
      backedUp: authenticator.credentialBackedUp,
      rpID: origin.rpID,
      origin: origin.origin,
      ceremonyTimestamp: now.toISOString(),
    },
    payeeId: binding.payee.id,
  };

  const digest = createHash("sha256").update(JSON.stringify(body)).digest("base64");
  return {
    ...body,
    signature: {
      alg: "MOCK-DEV-SIGNER",
      value: "mock-sig:" + digest,
      note: "Mock dev signer. Production replaces with AP2-conformant SD-JWT signing.",
    },
  };
}

export interface GateResult {
  gate: string;
  pass: boolean;
  detail: string;
}

export function runGates(mandate: PasskeyMandate): GateResult[] {
  const ua = mandate.userAuthorization;
  const lineSum = mandate.cart.lines.reduce((sum, l) => sum + l.lineTotal, 0);
  const results: GateResult[] = [];

  // Gate 1 — amount integrity: re-sum the cart lines, do NOT trust payment.amount.
  const amountOk = lineSum === mandate.payment.amount && lineSum === mandate.cart.total;
  results.push({
    gate: "Amount integrity",
    pass: amountOk,
    detail: `lines=${lineSum} · payment=${mandate.payment.amount} · cart.total=${mandate.cart.total}`,
  });

  // Gate 2 — authorization present & structurally a webauthn assertion.
  const authPresent = ua.type === "webauthn.assertion" && !!ua.credentialID;
  results.push({
    gate: "Authorization present",
    pass: authPresent,
    detail: `type=${ua.type} · credentialID=${ua.credentialID || "∅"}`,
  });

  // Gate 3 — user verification asserted by the authenticator.
  results.push({
    gate: "User verification",
    pass: ua.userVerified === true,
    detail: `userVerified=${ua.userVerified} · hardwareBacked=${ua.hardwareBacked}`,
  });

  // Gate 4 — subject binding: re-check subject == authorization credentialID.
  const subjectOk = !!mandate.subject.credentialID && mandate.subject.credentialID === ua.credentialID;
  results.push({
    gate: "Subject binding",
    pass: subjectOk,
    detail: `subject=${mandate.subject.credentialID} · auth=${ua.credentialID}`,
  });

  return results;
}
