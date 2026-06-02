# Payment Gate — Foundation + Passkey Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the checkout page's mock "Place order" button with a real WebAuthn authorization ceremony that produces a structurally-AP2 Payment Mandate validated against four gates, served identically on `localhost` and Vercel.

**Architecture:** A self-contained `payment-gate/` directory holds shared, stateless helpers (`origin.ts`, `challengeToken.ts`, `mandate.ts`) and a `passkey/` gate module mounted via `registerPasskeyGate(app)`. The gate is reached only from the existing `/checkout` page and reads the order solely from the URL token — it never touches the cart. Ephemeral WebAuthn challenge state rides in a `GATE_SECRET`-signed HMAC token (no server memory, serverless-correct).

**Tech Stack:** TypeScript (ESM, `node:` builtins), Express 5, `@simplewebauthn/server` + `@simplewebauthn/browser`, Vitest. Ports the technique (not the code) from `ucp-agentic-tester/spike/passkey-gate`.

**Scope note:** This is Plan 1 of 2. It covers the spec's incremental ladder rungs 1–4 (docs, foundation, passkey same-device, passkey cross-device). The **DC payment gate (rung 5)** — mdoc/CBOR decode, OpenID4VP, QR, cryptographic amount-binding — is a separate follow-up plan because it's an independent modality (the passkey page even falls back *to* it) and roughly doubles the surface area.

---

## Adaptation decisions (carried from the spec, locked here)

These differ from the spike and are intentional. They are the non-obvious calls; an executor should not "fix" them back to the spike's shape.

1. **Order, not the spike cart.** The spike builds a synthetic `cart` with `totals.total` (strings) and `merchant`. Here the authority is the existing `Order` (`catalog.ts`): `{ id, lines: PricedCartLine[], itemCount, total: number, currency, createdAt }`. The mandate embeds the `Order` as its `cart` field; amounts are numbers.
2. **Payee is derived, because `Order` has no merchant.** A single helper `buildBindingFields(order, origin)` returns `{ amount: order.total, currency: order.currency, payee: { id: <rpID host>, name: "Product Picker Demo" }, orderId: order.id }`. The payee id is the request host (same value as `rpID`), so "who is being paid" is the deployment itself — honest for a demo.
3. **Registration-as-gesture (single ceremony), stateless.** The spike does register-then-authenticate with an in-memory `session.expectedChallenge`. Here there is ONE `verifyRegistrationResponse` ceremony as the authorization gesture, and the challenge is recovered from a `GATE_SECRET`-signed token instead of server memory. One Touch ID, nothing persisted.
4. **Four passkey gates, all re-derived from the mandate's own fields.** Passkeys do not cryptographically sign the amount (that's the DC gate's job), so passkey amount-binding is *consistency*, not cryptographic proof: Gate 1 re-sums the cart lines and checks they equal `payment.amount`. No gate trusts a `verified` boolean.

---

## File structure

**Created:**
- `payment-gate/origin.ts` — derive `{ rpID, origin }` from a request (pure).
- `payment-gate/challengeToken.ts` — issue/verify stateless HMAC challenge tokens.
- `payment-gate/mandate.ts` — `buildBindingFields`, `buildPasskeyMandate`, `runGates`.
- `payment-gate/passkey/verify.ts` — `verifyPasskeyAssertion` (wraps `@simplewebauthn/server`).
- `payment-gate/passkey/page.ts` — server-rendered gate HTML (string).
- `payment-gate/passkey/routes.ts` — `registerPasskeyGate(app)` (3 routes).
- `payment-gate/README.md` — the concept + the FIDO caBLE cross-device section.
- `app.ts` — `createApp()` factory extracted from `main.ts` so routes mount in one place and tests import it.
- Tests: `payment-gate/origin.test.ts`, `payment-gate/challengeToken.test.ts`, `payment-gate/mandate.test.ts`, `payment-gate/passkey/verify.test.ts`, `payment-gate/passkey/page.test.ts`, `payment-gate/passkey/routes.test.ts`, `app.test.ts`.
- `payment-gate/passkey/fixtures/registration.json` — captured manually (Task 7a).

**Modified:**
- `main.ts` — delegate HTTP wiring to `createApp()`.
- `checkout.ts` — replace "Place order" with an "Authorize payment" panel linking to the gate.
- `package.json` — add `@simplewebauthn/server`, `@simplewebauthn/browser`.

---

## Task 1: Extract `createApp()` into `app.ts`

The gate needs one Express app it can mount into, and tests need to import the app without binding a port. Today the wiring lives inline in `main.ts:startHttpServer`. Extract it.

**Files:**
- Create: `app.ts`
- Create: `app.test.ts`
- Modify: `main.ts:17-72`

- [ ] **Step 1: Write the failing test**

`app.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";

describe("createApp", () => {
  it("serves the checkout page on /checkout with a valid order token", async () => {
    const app = createApp({ publicBaseUrl: "http://localhost:3001" });
    // An obviously-invalid token yields the 404 page, proving the route is mounted.
    const res = await request(app).get("/checkout?order=not-a-real-token");
    expect(res.status).toBe(404);
    expect(res.text).toContain("Order not found");
  });

  it("responds to POST /mcp", async () => {
    const app = createApp({ publicBaseUrl: "http://localhost:3001" });
    const res = await request(app).post("/mcp").send({ jsonrpc: "2.0", id: 1, method: "ping" });
    expect(res.status).toBeLessThan(500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app.test.ts`
Expected: FAIL — `Cannot find module './app.js'` (and `supertest` missing).

- [ ] **Step 3: Add supertest, then implement `createApp()`**

```bash
npm install -D supertest @types/supertest
```

`app.ts` — move the wiring out of `main.ts`. Keep behavior identical:
```ts
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import type { Express, Request, Response } from "express";
import { createServer } from "./server.js";
import { checkoutResponse, setCheckoutBaseUrl } from "./checkout.js";

export interface AppOptions {
  publicBaseUrl: string;
  allowedHosts?: string[];
}

export function createApp({ publicBaseUrl, allowedHosts }: AppOptions): Express {
  setCheckoutBaseUrl(publicBaseUrl);

  const app = createMcpExpressApp({ host: "0.0.0.0" });
  app.use(cors());

  app.get("/checkout", (req: Request, res: Response) => {
    const order = typeof req.query.order === "string" ? req.query.order : undefined;
    const { status, html } = checkoutResponse(order);
    res.status(status).type("html").send(html);
  });

  app.all("/mcp", async (req: Request, res: Response) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      ...(allowedHosts ? { enableDnsRebindingProtection: true, allowedHosts } : {}),
    });
    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  return app;
}
```

- [ ] **Step 4: Rewire `main.ts:startHttpServer` to use `createApp`**

Replace the body of `startHttpServer` (the inline app construction) with:
```ts
async function startHttpServer(): Promise<void> {
  const port = parseInt(process.env.PORT ?? "3001", 10);
  const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`;
  const allowedHosts = process.env.ALLOWED_HOSTS?.split(",").map((h) => h.trim()).filter(Boolean);

  const app = createApp({ publicBaseUrl, ...(allowedHosts ? { allowedHosts } : {}) });

  const httpServer = app.listen(port, () => {
    console.error(`MCP server listening on http://localhost:${port}/mcp`);
    console.error(`Checkout page on ${publicBaseUrl}/checkout`);
  });
  const shutdown = () => httpServer.close(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
```
Add `import { createApp } from "./app.js";` at the top; remove the now-unused `cors`, `createMcpExpressApp`, `StreamableHTTPServerTransport`, and `setCheckoutBaseUrl` imports from `main.ts` (keep `setCheckoutBaseUrl`/`startCheckoutHttpServer`/`checkoutResponse` only where still used — `startStdioServer` still calls `startCheckoutHttpServer`).

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run app.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add app.ts app.test.ts main.ts package.json package-lock.json
git commit -m "refactor: extract createApp() factory so routes mount in one place"
```

---

## Task 2: `payment-gate/origin.ts`

Derive WebAuthn RP identity from a request, honoring Vercel's `x-forwarded-*`.

**Files:**
- Create: `payment-gate/origin.ts`
- Create: `payment-gate/origin.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { deriveOrigin } from "./origin.js";

describe("deriveOrigin", () => {
  it("uses host + protocol for localhost dev", () => {
    expect(deriveOrigin({ headers: {}, host: "localhost:3001", protocol: "http" }))
      .toEqual({ rpID: "localhost", origin: "http://localhost:3001" });
  });

  it("strips the port from rpID but keeps it in origin", () => {
    expect(deriveOrigin({ headers: {}, host: "localhost:3001", protocol: "http" }).rpID)
      .toBe("localhost");
  });

  it("honors x-forwarded-host and x-forwarded-proto (Vercel)", () => {
    expect(deriveOrigin({
      headers: { "x-forwarded-host": "mcp-apps-nine.vercel.app", "x-forwarded-proto": "https" },
      host: "internal:3001",
      protocol: "http",
    })).toEqual({ rpID: "mcp-apps-nine.vercel.app", origin: "https://mcp-apps-nine.vercel.app" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run payment-gate/origin.test.ts`
Expected: FAIL — `Cannot find module './origin.js'`.

- [ ] **Step 3: Implement**

```ts
// Derive WebAuthn RP identity from a request. rpID is the host without port;
// origin is <proto>://<host>. Honors x-forwarded-* (Vercel terminates TLS).
// Pure over a minimal shape so it is unit-testable without a live request.
export interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  host: string;
  protocol: string;
}

export interface Origin {
  rpID: string;
  origin: string;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function deriveOrigin(req: RequestLike): Origin {
  const host = first(req.headers["x-forwarded-host"]) ?? req.host;
  const proto = first(req.headers["x-forwarded-proto"]) ?? req.protocol;
  const rpID = host.split(":")[0];
  return { rpID, origin: `${proto}://${host}` };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run payment-gate/origin.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add payment-gate/origin.ts payment-gate/origin.test.ts
git commit -m "feat(payment-gate): derive WebAuthn RP identity from request (x-forwarded aware)"
```

---

## Task 3: `payment-gate/challengeToken.ts`

Stateless WebAuthn challenge: a random challenge plus a signed token carrying it, so verify needs no server memory.

**Files:**
- Create: `payment-gate/challengeToken.ts`
- Create: `payment-gate/challengeToken.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { issueChallenge, verifyChallenge } from "./challengeToken.js";

const SECRET = "test-secret";

describe("challengeToken", () => {
  it("round-trips: verify recovers the issued challenge", () => {
    const { challenge, token } = issueChallenge(SECRET);
    expect(verifyChallenge(token, SECRET)).toBe(challenge);
  });

  it("rejects a token signed with a different secret", () => {
    const { token } = issueChallenge(SECRET);
    expect(() => verifyChallenge(token, "other-secret")).toThrow();
  });

  it("rejects a tampered challenge", () => {
    const { token } = issueChallenge(SECRET);
    const [chal, exp, sig] = token.split(".");
    const tampered = `${chal}X.${exp}.${sig}`;
    expect(() => verifyChallenge(tampered, SECRET)).toThrow();
  });

  it("rejects an expired token", () => {
    const { token } = issueChallenge(SECRET, -1); // already expired
    expect(() => verifyChallenge(token, SECRET)).toThrow(/expired/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run payment-gate/challengeToken.test.ts`
Expected: FAIL — `Cannot find module './challengeToken.js'`.

- [ ] **Step 3: Implement**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run payment-gate/challengeToken.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add payment-gate/challengeToken.ts payment-gate/challengeToken.test.ts
git commit -m "feat(payment-gate): stateless HMAC-signed WebAuthn challenge tokens"
```

---

## Task 4: `payment-gate/mandate.ts`

Binding fields, the passkey mandate builder, and the four-gate validator. Gates re-derive from the mandate's own fields.

**Files:**
- Create: `payment-gate/mandate.ts`
- Create: `payment-gate/mandate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildBindingFields, buildPasskeyMandate, runGates } from "./mandate.js";
import type { Order } from "../catalog.js";

const order: Order = {
  id: "ORD-TEST01",
  lines: [
    { id: "atlas-stand", name: "Atlas Laptop Stand", unitPrice: 49, currency: "USD", quantity: 2, lineTotal: 98 },
    { id: "drift-mouse", name: "Drift Ergonomic Mouse", unitPrice: 69, currency: "USD", quantity: 1, lineTotal: 69 },
  ],
  itemCount: 3,
  total: 167,
  currency: "USD",
  createdAt: "2026-05-31T00:00:00.000Z",
};

const verifiedAuthenticator = {
  credentialID: "cred-abc",
  userVerified: true,
  credentialDeviceType: "multiDevice" as const,
  credentialBackedUp: true,
};

describe("buildBindingFields", () => {
  it("derives amount/currency/payee/orderId from the order + origin", () => {
    const fields = buildBindingFields(order, { rpID: "localhost", origin: "http://localhost:3001" });
    expect(fields).toEqual({
      amount: 167,
      currency: "USD",
      payee: { id: "localhost", name: "Product Picker Demo" },
      orderId: "ORD-TEST01",
    });
  });
});

describe("buildPasskeyMandate + runGates", () => {
  it("produces an ap2.PaymentMandate whose four gates all pass", () => {
    const mandate = buildPasskeyMandate({
      order,
      authenticator: verifiedAuthenticator,
      origin: { rpID: "localhost", origin: "http://localhost:3001" },
    });
    expect(mandate.type).toBe("ap2.PaymentMandate");
    expect(mandate.payment.amount).toBe(167);
    const gates = runGates(mandate);
    expect(gates).toHaveLength(4);
    expect(gates.every((g) => g.pass)).toBe(true);
    expect(gates.map((g) => g.gate)).toEqual([
      "Amount integrity",
      "Authorization present",
      "User verification",
      "Subject binding",
    ]);
  });

  it("fails Gate 1 when payment.amount is tampered (re-derived from cart lines)", () => {
    const mandate = buildPasskeyMandate({
      order,
      authenticator: verifiedAuthenticator,
      origin: { rpID: "localhost", origin: "http://localhost:3001" },
    });
    mandate.payment.amount = 1; // tamper
    const gates = runGates(mandate);
    expect(gates.find((g) => g.gate === "Amount integrity")!.pass).toBe(false);
  });

  it("fails Gate 4 when subject and authorization credentialIDs disagree", () => {
    const mandate = buildPasskeyMandate({
      order,
      authenticator: verifiedAuthenticator,
      origin: { rpID: "localhost", origin: "http://localhost:3001" },
    });
    mandate.subject.credentialID = "someone-else";
    expect(runGates(mandate).find((g) => g.gate === "Subject binding")!.pass).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run payment-gate/mandate.test.ts`
Expected: FAIL — `Cannot find module './mandate.js'`.

- [ ] **Step 3: Implement**

```ts
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
      hardwareBacked:
        authenticator.credentialDeviceType === "multiDevice" ||
        authenticator.credentialDeviceType === "singleDevice",
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run payment-gate/mandate.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add payment-gate/mandate.ts payment-gate/mandate.test.ts
git commit -m "feat(payment-gate): AP2 passkey mandate + four re-derived gates"
```

---

## Task 5: `payment-gate/passkey/verify.ts`

Wrap `@simplewebauthn/server` registration verification, recovering the challenge from the token.

**Files:**
- Create: `payment-gate/passkey/verify.ts`
- Modify: `package.json` (add deps)

- [ ] **Step 1: Add dependencies**

```bash
npm install @simplewebauthn/server @simplewebauthn/browser
```

- [ ] **Step 2: Implement (no separate unit test here — exercised by the fixture test in Task 7 and the route test)**

```ts
// Single registration ceremony as the authorization gesture. The challenge is
// recovered from the signed token (stateless), not server memory.
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { issueChallenge, verifyChallenge } from "../challengeToken.js";
import type { Origin } from "../origin.js";
import type { VerifiedAuthenticator } from "../mandate.js";

const RP_NAME = "Product Picker";

// Build registration options + a signed challenge token. userID is ephemeral —
// we never persist the credential, so a fresh random user each time is fine.
export async function buildRegistrationOptions(origin: Origin, secret: string) {
  const { challenge, token } = issueChallenge(secret);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: origin.rpID,
    userName: "product-picker-user",
    challenge: Buffer.from(challenge, "base64url"),
    attestationType: "none",
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
  });
  return { options, challengeToken: token };
}

export async function verifyPasskeyAssertion(args: {
  response: RegistrationResponseJSON;
  challengeToken: string;
  origin: Origin;
  secret: string;
}): Promise<VerifiedAuthenticator> {
  const expectedChallenge = verifyChallenge(args.challengeToken, args.secret);
  const verification = await verifyRegistrationResponse({
    response: args.response,
    expectedChallenge,
    expectedOrigin: args.origin.origin,
    expectedRPID: args.origin.rpID,
    requireUserVerification: true,
  });
  if (!verification.verified || !verification.registrationInfo) {
    throw new Error("registration not verified");
  }
  const info = verification.registrationInfo;
  return {
    credentialID: info.credential.id,
    userVerified: true,
    credentialDeviceType: info.credentialDeviceType,
    credentialBackedUp: info.credentialBackedUp,
  };
}

export { issueChallenge };
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add payment-gate/passkey/verify.ts package.json package-lock.json
git commit -m "feat(payment-gate): passkey registration-as-gesture verifier"
```

---

## Task 6: `payment-gate/passkey/page.ts`

Server-rendered gate HTML embedding the order's binding fields and driving the ceremony with `@simplewebauthn/browser`.

**Files:**
- Create: `payment-gate/passkey/page.ts`
- Create: `payment-gate/passkey/page.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { renderPasskeyPage } from "./page.js";
import type { Order } from "../../catalog.js";

const order: Order = {
  id: "ORD-PAGE01",
  lines: [{ id: "drift-mouse", name: "Drift Ergonomic Mouse", unitPrice: 69, currency: "USD", quantity: 1, lineTotal: 69 }],
  itemCount: 1,
  total: 69,
  currency: "USD",
  createdAt: "2026-05-31T00:00:00.000Z",
};

describe("renderPasskeyPage", () => {
  it("shows the amount being authorized and the order id", () => {
    const html = renderPasskeyPage({ order, orderToken: "TOKEN123" });
    expect(html).toContain("$69.00");
    expect(html).toContain("ORD-PAGE01");
  });

  it("loads the WebAuthn browser ESM from a same-origin path (no CDN)", () => {
    const html = renderPasskeyPage({ order, orderToken: "TOKEN123" });
    expect(html).toContain('from "/payment-gate/lib/sw/index.js"');
    expect(html).not.toContain("https://unpkg.com");
  });

  it("embeds the order token so the client posts it back", () => {
    const html = renderPasskeyPage({ order, orderToken: "TOKEN123" });
    expect(html).toContain("TOKEN123");
  });

  it("escapes order field values", () => {
    const evil = { ...order, id: '"><script>x()</script>' };
    const html = renderPasskeyPage({ order: evil, orderToken: "T" });
    expect(html).not.toContain("<script>x()</script>");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run payment-gate/passkey/page.test.ts`
Expected: FAIL — `Cannot find module './page.js'`.

- [ ] **Step 3: Implement**

```ts
// Server-rendered passkey gate page. Shows the binding fields (amount/order),
// then runs ONE registration ceremony and POSTs the result with the challenge +
// order tokens. Loads @simplewebauthn/browser ESM from a same-origin static path.
import type { Order } from "../../catalog.js";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function money(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}

export function renderPasskeyPage(args: { order: Order; orderToken: string }): string {
  const { order, orderToken } = args;
  const rows = order.lines
    .map((l) => `<tr><td>${escapeHtml(l.name)} <span style="color:#999;">×${l.quantity}</span></td><td class="amt">${money(l.lineTotal, l.currency)}</td></tr>`)
    .join("\n");
  const token = escapeHtml(orderToken);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Authorize payment · ${escapeHtml(order.id)}</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 540px; margin: 3rem auto; padding: 0 1.25rem; color: #1a1a1a; }
  h1 { font-size: 1.35rem; margin-bottom: 0.25rem; }
  p.lede { color: #555; margin-top: 0; line-height: 1.45; }
  table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 0.95rem; }
  td { padding: 0.35rem 0; border-bottom: 1px solid #f0f0f0; }
  td.amt { text-align: right; font-variant-numeric: tabular-nums; }
  tr.total td { border-bottom: none; font-weight: 600; padding-top: 0.6rem; }
  button { font-size: 1rem; padding: 0.75rem 1.1rem; border-radius: 6px; border: 1px solid #1a7f37; background: #1a7f37; color: #fff; cursor: pointer; width: 100%; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .step { padding: 0.4rem 0; font-family: ui-monospace, Menlo, monospace; font-size: 0.85rem; }
  .step.ok { color: #0a7f2e; } .step.err { color: #b00020; white-space: pre-wrap; }
  #receipt { display: none; margin-top: 1.25rem; padding: 1rem 1.1rem; background: #ecfdf3; border-left: 4px solid #0a7f2e; border-radius: 6px; }
  .gate { font-family: ui-monospace, Menlo, monospace; font-size: 0.82rem; padding: 0.15rem 0; }
  .gate.pass { color: #0a7f2e; } .gate.fail { color: #b00020; }
</style>
</head>
<body>
  <h1>Authorize payment</h1>
  <p class="lede">An agent prepared this order. Authorize the exact amount with your device's secure element (Touch ID, Windows Hello, or a phone via cross-device sign-in). Nothing is charged — this is a demo authorization ceremony.</p>
  <table>
    ${rows}
    <tr class="total"><td>Total · order ${escapeHtml(order.id)}</td><td class="amt">${money(order.total, order.currency)}</td></tr>
  </table>
  <button id="go">Authorize ${money(order.total, order.currency)}</button>
  <div id="log"></div>
  <div id="receipt"></div>
  <script type="module">
    import { startRegistration } from "/payment-gate/lib/sw/index.js";
    const ORDER_TOKEN = ${JSON.stringify(token)};
    const log = document.getElementById("log");
    const btn = document.getElementById("go");
    const step = (t, c = "") => { const d = document.createElement("div"); d.className = "step " + c; d.textContent = t; log.appendChild(d); };
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        step("→ GET options");
        const { options, challengeToken } = await fetch("/payment-gate/passkey/options").then((r) => r.json());
        step("→ Touch ID / passkey prompt");
        const response = await startRegistration({ optionsJSON: options });
        step("→ verify");
        const out = await fetch("/payment-gate/passkey/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ response, challengeToken, orderToken: ORDER_TOKEN }),
        }).then((r) => r.json());
        if (!out.mandate) throw new Error(out.error || "authorization failed");
        step("✓ authorized · mandate built", "ok");
        renderReceipt(out);
      } catch (err) {
        step("✗ " + (err?.message ?? String(err)), "err");
        btn.disabled = false;
      }
    });
    function renderReceipt(out) {
      const el = document.getElementById("receipt");
      const gates = out.gates.map((g) => '<div class="gate ' + (g.pass ? "pass" : "fail") + '">' + (g.pass ? "✓" : "✗") + " " + g.gate + " — " + g.detail + "</div>").join("");
      el.innerHTML = "<div style=\\"font-weight:600;color:#0a7f2e;\\">✓ Payment Mandate authorized</div>" +
        "<div style=\\"font-size:0.8rem;color:#666;margin:0.3rem 0 0.6rem;\\">" + out.mandate.id + "</div>" + gates;
      el.style.display = "block";
    }
  </script>
</body>
</html>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run payment-gate/passkey/page.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add payment-gate/passkey/page.ts payment-gate/passkey/page.test.ts
git commit -m "feat(payment-gate): server-rendered passkey gate page"
```

---

## Task 7: `payment-gate/passkey/routes.ts` + mounting

Mount the three routes and the browser ESM static path; wire into `createApp`.

**Files:**
- Create: `payment-gate/passkey/routes.ts`
- Create: `payment-gate/passkey/routes.test.ts`
- Modify: `app.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";
import { encodeOrder } from "../../checkout.js";
import { createOrder } from "../../catalog.js";

function appWithOrderToken() {
  const app = createApp({ publicBaseUrl: "http://localhost:3001" });
  const order = createOrder([{ productId: "drift-mouse", quantity: 1 }], "ORD-RT01");
  return { app, token: encodeOrder(order) };
}

describe("passkey gate routes", () => {
  it("GET /payment-gate/passkey renders the page with the amount", async () => {
    const { app, token } = appWithOrderToken();
    const res = await request(app).get(`/payment-gate/passkey?order=${token}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("Authorize payment");
    expect(res.text).toContain("ORD-RT01");
  });

  it("GET /payment-gate/passkey with a bad order token → 404 page", async () => {
    const app = createApp({ publicBaseUrl: "http://localhost:3001" });
    const res = await request(app).get("/payment-gate/passkey?order=garbage");
    expect(res.status).toBe(404);
  });

  it("GET /payment-gate/passkey/options returns options + a challenge token", async () => {
    const { app } = appWithOrderToken();
    const res = await request(app).get("/payment-gate/passkey/options");
    expect(res.status).toBe(200);
    expect(res.body.options.challenge).toBeTruthy();
    expect(typeof res.body.challengeToken).toBe("string");
  });

  it("POST /payment-gate/passkey/verify with a bad challenge token → 400", async () => {
    const { app, token } = appWithOrderToken();
    const res = await request(app)
      .post("/payment-gate/passkey/verify")
      .send({ response: {}, challengeToken: "bad.bad.bad", orderToken: token });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run payment-gate/passkey/routes.test.ts`
Expected: FAIL — `registerPasskeyGate` not mounted (routes 404 / module missing).

- [ ] **Step 3: Implement `routes.ts`**

```ts
import express, { type Express, type Request, type Response } from "express";
import { createRequire } from "node:module";
import { decodeOrder } from "../../checkout.js";
import { deriveOrigin } from "../origin.js";
import { gateSecret } from "../challengeToken.js";
import { buildPasskeyMandate, buildBindingFields, runGates } from "../mandate.js";
import { buildRegistrationOptions, verifyPasskeyAssertion } from "./verify.js";
import { renderPasskeyPage } from "./page.js";

function originOf(req: Request) {
  return deriveOrigin({ headers: req.headers, host: req.get("host") ?? "localhost", protocol: req.protocol });
}

export function registerPasskeyGate(app: Express): void {
  // Serve @simplewebauthn/browser ESM from a same-origin path (no CDN).
  const requireFrom = createRequire(import.meta.url);
  const browserEsmDir = requireFrom
    .resolve("@simplewebauthn/browser")
    .replace(/\/(esm|cjs)\/index\.(m?js)$/, "/esm");
  app.use("/payment-gate/lib/sw", express.static(browserEsmDir));

  app.get("/payment-gate/passkey", (req: Request, res: Response) => {
    const token = typeof req.query.order === "string" ? req.query.order : undefined;
    const order = token ? decodeOrder(token) : undefined;
    if (!order || !token) {
      res.status(404).type("html").send("<!doctype html><h1>Order not found</h1>");
      return;
    }
    res.status(200).type("html").send(renderPasskeyPage({ order, orderToken: token }));
  });

  app.get("/payment-gate/passkey/options", async (req: Request, res: Response) => {
    const { options, challengeToken } = await buildRegistrationOptions(originOf(req), gateSecret());
    res.json({ options, challengeToken });
  });

  app.post("/payment-gate/passkey/verify", async (req: Request, res: Response) => {
    const { response, challengeToken, orderToken } = req.body ?? {};
    const order = typeof orderToken === "string" ? decodeOrder(orderToken) : undefined;
    if (!order) {
      res.status(400).json({ error: "invalid order token" });
      return;
    }
    try {
      const origin = originOf(req);
      const authenticator = await verifyPasskeyAssertion({ response, challengeToken, origin, secret: gateSecret() });
      const mandate = buildPasskeyMandate({ order, authenticator, origin });
      const gates = runGates(mandate);
      res.json({ mandate, gates, binding: buildBindingFields(order, origin) });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });
}
```

- [ ] **Step 4: Mount in `app.ts`**

In `createApp`, after the `/mcp` route is registered, add:
```ts
  registerPasskeyGate(app);
```
and at the top: `import { registerPasskeyGate } from "./payment-gate/passkey/routes.js";`

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run payment-gate/passkey/routes.test.ts && npm run typecheck`
Expected: PASS (4 tests), no type errors.

- [ ] **Step 6: Commit**

```bash
git add payment-gate/passkey/routes.ts payment-gate/passkey/routes.test.ts app.ts
git commit -m "feat(payment-gate): mount passkey gate routes + browser ESM"
```

---

## Task 7a: Capture the WebAuthn fixture + fixture verify test (manual + automated)

The verifier's cryptographic path can only be tested against a real registration response (the signature must verify against the challenge). No fixture exists in the spike, so capture one once, then add a test that loads it.

**Files:**
- Create: `payment-gate/passkey/fixtures/registration.json`
- Create: `payment-gate/passkey/verify.fixture.test.ts`

- [ ] **Step 1: Capture (manual, one-time)**

Run the app locally: `npm run build && PORT=3001 GATE_SECRET=fixture-secret node dist/main.js`, open `http://localhost:3001/payment-gate/passkey?order=<any-valid-token>` (generate a token by calling the `checkout` tool, or reuse one from a `/checkout` link), open DevTools → Network, click Authorize, complete Touch ID, and from the `verify` request capture the full request body. Save the JSON `{ response, challengeToken, origin: { rpID, origin } }` to `payment-gate/passkey/fixtures/registration.json`. Because the challenge token is time-limited and secret-bound, the fixture is only replayable with the **same `GATE_SECRET`** and before expiry checks — so the test stubs time (see Step 2).

> NOTE: This fixture is environment-bound. If capture is impractical in the executor's environment, mark this task blocked and proceed — the route test (Task 7) and the deterministic mandate/challenge tests already cover the non-cryptographic logic. The fixture test below is guarded to skip when the file is absent, so CI stays green.

- [ ] **Step 2: Add the guarded fixture test**

```ts
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { verifyPasskeyAssertion } from "./verify.js";

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "registration.json");
const hasFixture = existsSync(fixturePath);

describe.skipIf(!hasFixture)("verifyPasskeyAssertion (recorded fixture)", () => {
  const fx = hasFixture ? JSON.parse(readFileSync(fixturePath, "utf8")) : null;

  beforeAll(() => {
    // Freeze time to just after issuance so the challenge token has not expired.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(fx.capturedAt ?? Date.now()));
    process.env.GATE_SECRET = "fixture-secret";
  });
  afterAll(() => vi.useRealTimers());

  it("verifies the recorded registration and yields a verified authenticator", async () => {
    const auth = await verifyPasskeyAssertion({
      response: fx.response,
      challengeToken: fx.challengeToken,
      origin: fx.origin,
      secret: "fixture-secret",
    });
    expect(auth.userVerified).toBe(true);
    expect(auth.credentialID).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run**

Run: `npx vitest run payment-gate/passkey/verify.fixture.test.ts`
Expected: PASS if fixture captured; SKIPPED otherwise (both are green).

- [ ] **Step 4: Commit**

```bash
git add payment-gate/passkey/verify.fixture.test.ts payment-gate/passkey/fixtures/registration.json
git commit -m "test(payment-gate): recorded-fixture verifier test (guarded)"
```

---

## Task 8: Replace "Place order" with "Authorize payment" on the checkout page

**Files:**
- Modify: `checkout.ts:73-120` (`renderCheckoutPage`) and add `buildBindingFields` display.
- Create/extend: `checkout.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `checkout.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { checkoutResponse, createCheckoutOrder, encodeOrder } from "./checkout.js";
import { createOrder } from "./catalog.js";

describe("checkout page authorization affordance", () => {
  it("renders an Authorize payment link to the passkey gate instead of a mock button", () => {
    const order = createOrder([{ productId: "drift-mouse", quantity: 1 }], "ORD-CO01");
    const { status, html } = checkoutResponse(encodeOrder(order));
    expect(status).toBe(200);
    expect(html).toContain("/payment-gate/passkey?order=");
    expect(html).toContain("Authorize payment");
    expect(html).not.toContain("Place order");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run checkout.test.ts`
Expected: FAIL — page still has "Place order", no gate link.

- [ ] **Step 3: Implement**

In `checkout.ts`, the page needs the order token to build the link. Thread it through `renderCheckoutPage`. Change `checkoutResponse` to pass the token:
```ts
export function checkoutResponse(token: string | undefined): { status: number; html: string } {
  const order = token ? decodeOrder(token) : undefined;
  if (!order || !token) return { status: 404, html: renderNotFound() };
  return { status: 200, html: renderCheckoutPage(order, token) };
}
```
Update `renderCheckoutPage(order: Order, token: string)` — replace the `<button id="place">…</button>` + its `<script>` with:
```ts
  <a id="authorize" href="/payment-gate/passkey?order=${encodeURIComponent(token)}"
     style="display:block;margin-top:24px;width:100%;padding:14px;font-size:15px;font-weight:600;
     text-align:center;color:#fff;background:#1a7f37;border-radius:8px;text-decoration:none;">
    Authorize payment
  </a>
  <div class="note">You'll confirm the exact amount with your device. Demo — no real charge.</div>
```
(Remove the now-unused inline `<script>` and the `button`/`button:disabled` CSS if no longer referenced.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run checkout.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add checkout.ts checkout.test.ts
git commit -m "feat(payment-gate): checkout page hands off to the passkey gate"
```

---

## Task 9: Docs (README) + cross-device rung

Rung 1 + rung 4 of the spec ladder: the concept doc and the FIDO caBLE cross-device framing. Cross-device needs no new code — the browser's "use a phone" path runs the same ceremony over caBLE.

**Files:**
- Create: `payment-gate/README.md`
- Modify: `README.md` (link the gate from the Demo area)

- [ ] **Step 1: Write `payment-gate/README.md`**

Cover: what the gate is (authorization ceremony at checkout hand-off, not a charge); the stateless design (order in URL token, challenge in `GATE_SECRET`-signed token, no server memory, no storage dependency); the four gates and that they're re-derived; running it locally (`GATE_SECRET`, secure context note — WebAuthn needs HTTPS or `localhost`); and a `### The cross-device channel (FIDO caBLE)` section explaining that selecting "use a phone" drives the ceremony to a nearby device over caBLE (BLE proximity + a tunnel), the assertion returns to the desktop, and our server verifies it the same way — the phone never talks to our server.

- [ ] **Step 2: Link from the top-level README**

Add a line under the Demo area pointing to `payment-gate/README.md` and noting the "Authorize payment" step replaces the old mock button.

- [ ] **Step 3: Manual cross-device verification (documented, not automated)**

On the deployed HTTPS origin, open the checkout page → Authorize → choose "use a phone," scan with the phone, complete biometric. Confirm the desktop receives the assertion and renders the four-gate receipt. Record the result in `payment-gate/README.md` under a "Verified" note.

- [ ] **Step 4: Commit**

```bash
git add payment-gate/README.md README.md
git commit -m "docs(payment-gate): concept + FIDO caBLE cross-device section"
```

---

## Self-Review

**Spec coverage (rungs 1–4):**
- Rung 1 (docs) → Task 9. ✓
- Rung 2 (foundation: mandate.ts, origin.ts, challengeToken.ts + tests) → Tasks 2, 3, 4. ✓
- Rung 3 (passkey same-device: routes mounted, checkout links, Touch ID) → Tasks 5, 6, 7, 7a, 8. ✓
- Rung 4 (passkey cross-device via caBLE; test + README rung) → Task 9 (step 3). ✓
- Spec components: `origin.ts` ✓ (T2), `challengeToken.ts` ✓ (T3), `mandate.ts` ✓ (T4), `passkey/routes.ts` ✓ (T7), `passkey/page.ts` ✓ (T6), `passkey/verify.ts` ✓ (T5), `passkey/*.test` ✓ (T4/T7/T7a). Touched files `checkout.ts` ✓ (T8), `app.ts` ✓ (T1/T7), `package.json` ✓ (T5). `jose` is NOT added here — it's only needed by the DC gate (Plan 2).
- **Deferred to Plan 2 (DC payment gate, rung 5):** `dc-payment/` (txData, mdoc/CBOR decode, vp-inspect, QR page, OpenID4VP verify, amount-binding gate), `jose` dependency, the DC half of the four-gate validator, and the checkout page's secondary cross-device link to `/payment-gate/dc-payment`.

**Placeholder scan:** No "TBD"/"handle errors"/"similar to" — every code step has complete code. Task 7a is explicitly a manual capture with a guarded, skipping test (honest about the live dependency), not a placeholder.

**Type consistency:** `Origin` (origin.ts) used by mandate.ts + verify.ts + routes.ts. `VerifiedAuthenticator` (mandate.ts) returned by verify.ts, consumed by buildPasskeyMandate. `PasskeyMandate`/`GateResult` consistent across mandate.ts and its consumers. `buildBindingFields(order, origin)`, `buildPasskeyMandate({order, authenticator, origin})`, `runGates(mandate)`, `verifyPasskeyAssertion({response, challengeToken, origin, secret})`, `buildRegistrationOptions(origin, secret)` — signatures match every call site. `checkoutResponse(token)` → `renderCheckoutPage(order, token)` threaded in Task 8.

**Open risk flagged for the executor:** the `@simplewebauthn/browser` ESM static path in `routes.ts` Step 3 resolves the package's `esm` dir via `createRequire`; if the installed package layout differs, adjust the `.replace(...)` to point at the directory containing `index.js`. Verify with a real `GET /payment-gate/lib/sw/index.js` returning 200 during Task 7 Step 5.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-31-payment-gate-passkey.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
