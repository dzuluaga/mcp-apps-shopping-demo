// Thin HTTP client for the AP2 Python sidecar (ap2-sidecar/), which wraps the
// official AP2 SDK to build + verify real SD-JWT PaymentMandates. The payment
// gates extract device evidence (WebAuthn / mdoc) here in TS, then delegate the
// mandate envelope + gates to the sidecar over this client.
//
// Base URL: AP2_SIDECAR_URL (default http://localhost:8787). On Vercel this
// points at the same-origin Python function (Task 5).
import type { Order } from "../catalog.js";

const DEFAULT_SIDECAR_URL = "http://localhost:8787";

function strip(u: string): string {
  return u.replace(/\/$/, "");
}

// Where the AP2 sidecar lives:
// - explicit AP2_SIDECAR_URL wins;
// - on Vercel it's the SAME origin (the Python function is mounted under
//   `/ap2/*` via vercel.json), so reuse the deployment origin;
// - locally it's a separate process on :8787 (spawned by ap2Sidecar.ts).
// The client always appends `/ap2/payment-mandate[/verify]`, which the sidecar
// app serves directly (local) or Vercel rewrites to the Python function.
function sidecarUrl(): string {
  if (process.env.AP2_SIDECAR_URL) return strip(process.env.AP2_SIDECAR_URL);
  if (process.env.VERCEL) {
    const origin =
      process.env.PUBLIC_BASE_URL ??
      (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : undefined);
    if (origin) return strip(origin);
  }
  return DEFAULT_SIDECAR_URL;
}

export type Ap2Channel = "passkey" | "dc";

// Wire shape of an order line, matching the sidecar's `LineItemIn` (camelCase,
// dollars). It is exactly `Order.lines[number]`, but named for the contract.
export interface Ap2GateResult {
  gate: string;
  pass: boolean;
  detail: string;
}

export interface BuildMandateArgs {
  order: Order;
  channel: Ap2Channel;
  authorization: Record<string, unknown>;
  payeeId: string;
}

export interface BuildMandateResult {
  mandate: string; // compact SD-JWT
  mandateId: string;
}

export interface VerifyMandateArgs {
  mandate: string;
  expectedAmount: number; // dollars
  expectedCurrency: string;
  expectedPayeeId: string;
}

export interface VerifyMandateResult {
  valid: boolean;
  gates: Ap2GateResult[];
  payload: Record<string, unknown> | null;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(sidecarUrl() + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`AP2 sidecar ${path} -> ${res.status} ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

// The sidecar reads `Order` directly (its `OrderIn` mirrors the TS fields), so
// no field translation is needed — we pass the order through as-is.
export async function buildMandate(args: BuildMandateArgs): Promise<BuildMandateResult> {
  return postJson<BuildMandateResult>("/ap2/payment-mandate", {
    order: args.order,
    channel: args.channel,
    authorization: args.authorization,
    payeeId: args.payeeId,
  });
}

export async function verifyMandate(args: VerifyMandateArgs): Promise<VerifyMandateResult> {
  return postJson<VerifyMandateResult>("/ap2/payment-mandate/verify", args);
}
