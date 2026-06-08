// Binding fields shared by both payment gates: the amount/currency/payee/order
// the user is authorizing. The AP2 mandate itself (envelope + signing + the
// validation gates) is now produced by the AP2 sidecar via `ap2Client.ts`; this
// module only derives the binding inputs the gates and the page receipt show.
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

// Minimal shape of what @simplewebauthn returns that we carry into the mandate
// as device evidence (see passkey/verify.ts and the sidecar's risk_data claim).
export interface VerifiedAuthenticator {
  credentialID: string;
  userVerified: boolean;
  credentialDeviceType: "singleDevice" | "multiDevice";
  credentialBackedUp: boolean;
}
