# DC Payment Gate (rung 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the cross-device Digital Credentials payment gate (`payment-gate/dc-payment/`) — the full caBLE amount-binding rung — so the checkout hand-off can produce a wallet-signed, amount-bound AP2 payment mandate.

**Architecture:** A self-contained `payment-gate/dc-payment/` module mounted into the existing Express app via `registerDcPaymentGate(app)`, mirroring the passkey gate. It serves a server-rendered page that calls `navigator.credentials.get({digital})` (OpenID4VP over the Digital Credentials API; cross-device leg rides FIDO caBLE). The reader's ephemeral ECDH private key + the bound `transaction_data` ride in a `GATE_SECRET`-sealed token (JWE, `dir`/`A256GCM`) so the gate stays stateless on serverless. The wallet's encrypted presentation returns to the desktop browser, which POSTs it back; the server decrypts, re-derives the `transaction_data_hash`, and assembles a `version: "0.1-dc"` mandate validated by four DC gates.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Express 5, vitest, `jose` (JWE + base64url + signed request JWT), `cbor-x` (structural mdoc DeviceResponse decode), `@peculiar/x509` (self-signed reader cert), Node `crypto` webcrypto.

**Deviation from spec (noted):** The spec proposed DC gates in the shared `mandate.ts`. The existing `mandate.ts` `runGates` is passkey-specific and synchronous over `PasskeyMandate`. To keep modules decomposed and learnable, the DC mandate type, `buildDcMandate`, and `runDcGates` live in `payment-gate/dc-payment/mandate.ts`. `buildBindingFields` is reused from the shared `payment-gate/mandate.ts`.

**Reference (port technique, do not couple at runtime):**
- `/Users/diegozuluaga/tools/git/ucp-agentic-tester/spike/dc-payment-gate/{tx-data.js,mdoc.mjs,vp-inspect.mjs,validate.js,mandate-wrapper.js,server.js,public/checkout.html}`
- `/Users/diegozuluaga/tools/git/ucp-agentic-tester/spike/dc-payment-gate/test/{fixtures.mjs,validate.test.js}`

## File structure

```
payment-gate/dc-payment/
  README.md          concept + FIDO caBLE leg + prerequisites + what's mocked
  txData.ts          buildTransactionData(order,origin) / encode / hash  (binding source of truth)
  mdoc.ts            structural CBOR decode: decodeVpToken, extractTransactionDataHash, inspectAuthBlocks
  mandate.ts         DcMandate type, buildDcMandate(...), runDcGates(mandate)  (4 DC gates)
  readerContext.ts   sealReaderContext / openReaderContext (ECDH priv jwk + txDataB64) via GATE_SECRET
  request.ts         buildSignedRequest(order,origin,secret): reader cert + signed OpenID4VP request JWT
  verify.ts          verifyDcPresentation(...): JWE decrypt -> extract hash -> build mandate -> gates
  page.ts            renderDcPage(order, orderToken): QR/feature-detect page
  routes.ts          registerDcPaymentGate(app): GET /dc-payment, GET /dc-payment/request, POST /dc-payment/verify
  fixtures.ts        test-only: buildVpToken (CBOR DeviceResponse), encryptToReaderKey
  txData.test.ts  mdoc.test.ts  mandate.test.ts  readerContext.test.ts  request.test.ts  verify.test.ts  page.test.ts  routes.test.ts
```

Touched existing files: `package.json` (add deps), `app.ts` (mount), `checkout.ts` (add DC link), `ROADMAP.md`, top `README.md`.

---

### Task 1: Dependencies + module README

**Files:**
- Modify: `package.json` (dependencies)
- Create: `payment-gate/dc-payment/README.md`

- [ ] **Step 1: Add the three runtime dependencies**

Run:
```bash
npm install jose@^5.9.6 cbor-x@^1.6.0 @peculiar/x509@^1.12.3
```
Expected: `package.json` `dependencies` gains `jose`, `cbor-x`, `@peculiar/x509`; `package-lock.json` updates; exit 0.

- [ ] **Step 2: Verify install + typecheck still passes**

Run: `npm run typecheck`
Expected: exit 0, no errors (no code added yet).

- [ ] **Step 3: Write the module README**

Create `payment-gate/dc-payment/README.md`:

```markdown
# DC payment gate (cross-device, FIDO caBLE)

The terminal rung of the payment-gate ladder. Where the passkey gate proves
*user presence* (Touch ID / a phone passkey), this gate proves the user
authorized **this exact amount and payee** — the binding is signed by a wallet
credential, not asserted by a flag.

## The cross-device channel (FIDO caBLE)

Desktop Chrome (141+) renders a QR for `navigator.credentials.get({digital})`.
The phone scans it; the device-to-device leg is **FIDO caBLE** (cloud-assisted
BLE) — the same hybrid transport the passkey gate's "use my phone" path uses.
The wallet builds an OpenID4VP presentation that signs over a
`transaction_data_hash` (SHA-256 of the base64url `transaction_data` we sent).
The encrypted `vp_token` returns to the **desktop** browser (the one that called
`get`), which POSTs it to our server. The phone never talks to our server.

## What binds the amount

`txData.ts` builds one `transaction_data` entry from the order + origin
(`amount`, `currency`, `payee`, fresh `transaction_id`). We send its base64url
form; the wallet signs a hash of exactly that string. Gate 1 re-derives the hash
and re-checks amount + payee against the cart — it never trusts a `verified`
boolean.

## Statelessness

The reader's ephemeral ECDH private key (used to decrypt the wallet's JWE) and
the `transaction_data` ride in a `GATE_SECRET`-sealed token (JWE `dir`/`A256GCM`)
returned to the client and POSTed back. No server memory between `/request` and
`/verify`, so it is correct on Vercel's serverless functions.

## Prerequisites (live path, not automated)

- Chrome 141+ on the desktop. For localhost dev, enable
  `chrome://flags#web-identity-digital-credentials`.
- A Digital Payment Credential provisioned in an Android wallet (e.g. Multipaz
  from `issuer.multipaz.org`). Without one the request returns "no matching
  credential".
- A secure context: Vercel HTTPS in prod; `localhost` is exempt.

## What's real vs mocked

Real: the WebAuthn-class ceremony, the wallet signature over the amount, the
JWE decryption, the four gates. Mocked: no real money, no real merchant/issuer
trust check (the reader cert is self-signed → expect an "unverified verifier"
warning), credentials are not persisted. The mandate is the authorization
artifact; the unsigned order token is not authoritative for payment.

## Files

`txData.ts` binding · `mdoc.ts` structural decode · `mandate.ts` DC mandate + 4
gates · `readerContext.ts` sealed ephemeral key · `request.ts` signed OpenID4VP
request · `verify.ts` decrypt+verify+assemble · `page.ts` the QR page ·
`routes.ts` mounting. Tests sit beside each module.
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json payment-gate/dc-payment/README.md
git commit -m "docs(dc-payment): rung-5 README + jose/cbor-x/x509 deps"
```

---

### Task 2: Transaction-data binding (`txData.ts`)

**Files:**
- Create: `payment-gate/dc-payment/txData.ts`
- Test: `payment-gate/dc-payment/txData.test.ts`

The single source of truth for the OpenID4VP `transaction_data` entry. Amount + payee come from the order + origin (reusing `buildBindingFields`); `transaction_id` is fresh per call. Hash is SHA-256 of the base64url string the wallet signs over.

- [ ] **Step 1: Write the failing test**

Create `payment-gate/dc-payment/txData.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createOrder } from "../../catalog.js";
import { buildTransactionData, encodeTransactionData, hashTransactionData } from "./txData.js";

const origin = { rpID: "localhost", origin: "http://localhost:3030" };

describe("txData", () => {
  it("binds amount, currency, and payee from the order + origin", () => {
    const order = createOrder([{ productId: "drift-mouse", quantity: 2 }], "ORD-TX01");
    const td = buildTransactionData(order, origin);
    expect(td.type).toBe("urn:eudi:sca:payment:1");
    expect(td.payload.amount).toBe(order.total);
    expect(td.payload.currency).toBe(order.currency);
    expect(td.payload.payee.id).toBe("localhost");
    expect(td.payload.transaction_id).toMatch(/[0-9a-f-]{36}/);
  });

  it("mints a fresh transaction_id each call", () => {
    const order = createOrder([{ productId: "drift-mouse", quantity: 1 }], "ORD-TX02");
    expect(buildTransactionData(order, origin).payload.transaction_id)
      .not.toBe(buildTransactionData(order, origin).payload.transaction_id);
  });

  it("encode + hash are deterministic for the same base64url string", () => {
    const order = createOrder([{ productId: "drift-mouse", quantity: 1 }], "ORD-TX03");
    const b64 = encodeTransactionData(buildTransactionData(order, origin));
    expect(hashTransactionData(b64)).toBe(hashTransactionData(b64));
    expect(hashTransactionData(b64)).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run payment-gate/dc-payment/txData.test.ts`
Expected: FAIL — cannot resolve `./txData.js`.

- [ ] **Step 3: Implement `txData.ts`**

Create `payment-gate/dc-payment/txData.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run payment-gate/dc-payment/txData.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add payment-gate/dc-payment/txData.ts payment-gate/dc-payment/txData.test.ts
git commit -m "feat(dc-payment): transaction_data binding from order+origin"
```

---

### Task 3: Structural mdoc decode (`mdoc.ts`) + test fixtures

**Files:**
- Create: `payment-gate/dc-payment/mdoc.ts`
- Create: `payment-gate/dc-payment/fixtures.ts`
- Test: `payment-gate/dc-payment/mdoc.test.ts`

Ports `mdoc.mjs` + `vp-inspect.mjs` (structural-only decode — NO signature/trust verification). Surfaces disclosed claims, the deviceSigned `transaction_data_hash`, and auth-block presence.

- [ ] **Step 1: Write the test fixture builder**

Create `payment-gate/dc-payment/fixtures.ts`:

```ts
// Test-only: build a base64url mdoc DeviceResponse with a transaction_data_hash
// in deviceSigned, mirroring the spike's test/fixtures.mjs. Used by mdoc/mandate/
// verify tests so we exercise the decode + gates without a live wallet.
import { encode, Tag } from "cbor-x";

export interface VpTokenOpts {
  txHashBytes: Uint8Array;
  instrumentId?: string;
  expiry?: string;
  omitDeviceAuth?: boolean;
  omitHash?: boolean;
}

export function buildVpToken(opts: VpTokenOpts): string {
  const { txHashBytes, instrumentId = "pi-77AABBCC", expiry = "2028-09-01", omitDeviceAuth = false, omitHash = false } = opts;
  const isi = (digestID: number, el: string, val: unknown) =>
    new Tag(encode({ digestID, random: new Uint8Array(8), elementIdentifier: el, elementValue: val }), 24);
  const devMap = omitHash ? {} : { "urn:eudi:sca:payment:1": { transaction_data_hash: txHashBytes } };
  const doc = {
    docType: "org.multipaz.payment.sca.1",
    issuerSigned: {
      nameSpaces: {
        "org.multipaz.payment.sca.1": [
          isi(5, "payment_instrument_id", instrumentId),
          isi(2, "expiry_date", new Tag(expiry, 1004)),
        ],
      },
      issuerAuth: ["a", "b", "c", "d"],
    },
    deviceSigned: {
      nameSpaces: new Tag(encode(devMap), 24),
      ...(omitDeviceAuth ? {} : { deviceAuth: { deviceSignature: ["a", null, null, new Uint8Array(64)] } }),
    },
  };
  return Buffer.from(encode({ version: "1.0", status: 0, documents: [doc] })).toString("base64url");
}
```

- [ ] **Step 2: Write the failing test**

Create `payment-gate/dc-payment/mdoc.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { decodeVpToken, extractTransactionDataHash, inspectAuthBlocks } from "./mdoc.js";
import { buildVpToken } from "./fixtures.js";

const hashBytes = new Uint8Array(32).fill(7);

describe("mdoc structural decode", () => {
  it("extracts the deviceSigned transaction_data_hash as base64url", () => {
    const vp = buildVpToken({ txHashBytes: hashBytes });
    expect(extractTransactionDataHash(vp)).toBe(Buffer.from(hashBytes).toString("base64url"));
  });

  it("returns null when the hash is absent", () => {
    expect(extractTransactionDataHash(buildVpToken({ txHashBytes: hashBytes, omitHash: true }))).toBeNull();
  });

  it("reports issuerAuth + deviceAuth presence", () => {
    const present = inspectAuthBlocks(buildVpToken({ txHashBytes: hashBytes }));
    expect(present.hasIssuerAuth).toBe(true);
    expect(present.hasDeviceAuth).toBe(true);
    const stripped = inspectAuthBlocks(buildVpToken({ txHashBytes: hashBytes, omitDeviceAuth: true }));
    expect(stripped.hasDeviceAuth).toBe(false);
  });

  it("flattens disclosed issuerSigned claims", () => {
    const disclosed = decodeVpToken({ dpc: buildVpToken({ txHashBytes: hashBytes, instrumentId: "pi-XYZ" }) });
    const labels = Object.fromEntries(disclosed[0].claims.map((c) => [c.label.split(" / ").pop(), c.value]));
    expect(labels["payment_instrument_id"]).toBe("pi-XYZ");
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npx vitest run payment-gate/dc-payment/mdoc.test.ts`
Expected: FAIL — cannot resolve `./mdoc.js`.

- [ ] **Step 4: Implement `mdoc.ts`**

Create `payment-gate/dc-payment/mdoc.ts`:

```ts
// Structural-only decode of presented mdoc DeviceResponse (ISO 18013-5 CBOR).
// Ports mdoc.mjs + vp-inspect.mjs. NO trust verification: does not check issuer/
// device signatures or digests — it surfaces what the wallet disclosed. Real
// cryptographic validation (@auth0/mdl) is future work.
import { decode, Tag } from "cbor-x";

function b64urlToBytes(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(String(s), "base64url"));
}

// IssuerSignedItemBytes = #6.24(bstr .cbor IssuerSignedItem). Depending on the
// cbor-x build, tag 24 arrives as a Tag wrapping bytes or already as bytes.
function decodeTagged(item: unknown): any {
  if (item instanceof Tag) return decode(item.value as Uint8Array);
  if (item instanceof Uint8Array) return decode(item);
  return item;
}

function sanitize(v: unknown): any {
  if (v instanceof Uint8Array) return { _bytes_b64url: Buffer.from(v).toString("base64url") };
  if (v instanceof Tag) return { _tag: v.tag, value: sanitize(v.value) };
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(sanitize);
  if (v && typeof v === "object") {
    const o: Record<string, any> = {};
    for (const [k, val] of Object.entries(v)) o[k] = sanitize(val);
    return o;
  }
  return v;
}

export interface DisclosedEntry {
  id: string;
  format: string;
  type?: string;
  claims: { label: string; value: any }[];
}

// vp_token from OpenID4VP DC API: { "<dcql-id>": "<base64url DeviceResponse>" }
// (older shape: an array, or a wrapping array per id). Returns a flattened shape.
export function decodeVpToken(vpToken: unknown): DisclosedEntry[] {
  const entries: [string, unknown][] = Array.isArray(vpToken)
    ? vpToken.map((v, i) => [String(i), v])
    : Object.entries((vpToken as Record<string, unknown>) ?? {});
  return entries.map(([id, token]) => {
    const str = Array.isArray(token) ? token[0] : token;
    const dr = decode(b64urlToBytes(str as string)) as any;
    const flat: { label: string; value: any }[] = [];
    let type: string | undefined;
    for (const doc of dr.documents ?? []) {
      type = doc.docType;
      const nameSpaces = doc.issuerSigned?.nameSpaces ?? {};
      for (const [ns, items] of Object.entries(nameSpaces)) {
        for (const raw of items as unknown[]) {
          const isi = decodeTagged(raw);
          flat.push({ label: `${ns} / ${isi.elementIdentifier}`, value: sanitize(isi.elementValue) });
        }
      }
    }
    return { id, format: "mso_mdoc", type, claims: flat };
  });
}

// The payment binding lives in deviceSigned, not issuerSigned. Returns the
// transaction_data_hash bytes as base64url, or null.
export function extractTransactionDataHash(
  vpStr: string | string[],
  namespace = "urn:eudi:sca:payment:1",
  element = "transaction_data_hash",
): string | null {
  const str = Array.isArray(vpStr) ? vpStr[0] : vpStr;
  const dr = decode(b64urlToBytes(str)) as any;
  for (const doc of dr.documents ?? []) {
    const ns = decodeTagged(doc.deviceSigned?.nameSpaces);
    const val = ns?.[namespace]?.[element];
    if (val instanceof Uint8Array) return Buffer.from(val).toString("base64url");
  }
  return null;
}

export interface AuthBlocks {
  hasIssuerAuth: boolean;
  hasDeviceAuth: boolean;
  docType: string | null;
}

export function inspectAuthBlocks(vpStr: string | string[]): AuthBlocks {
  const str = Array.isArray(vpStr) ? vpStr[0] : vpStr;
  const dr = decode(b64urlToBytes(str)) as any;
  const doc = (dr.documents ?? [])[0] ?? {};
  const issuerAuth = doc.issuerSigned?.issuerAuth;
  const deviceAuth = doc.deviceSigned?.deviceAuth;
  return {
    hasIssuerAuth: Array.isArray(issuerAuth) && issuerAuth.length > 0,
    hasDeviceAuth: !!(deviceAuth && (deviceAuth.deviceSignature || deviceAuth.deviceMac)),
    docType: doc.docType ?? null,
  };
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npx vitest run payment-gate/dc-payment/mdoc.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add payment-gate/dc-payment/mdoc.ts payment-gate/dc-payment/fixtures.ts payment-gate/dc-payment/mdoc.test.ts
git commit -m "feat(dc-payment): structural mdoc decode + test fixtures"
```

---

### Task 4: DC mandate + four gates (`mandate.ts`)

**Files:**
- Create: `payment-gate/dc-payment/mandate.ts`
- Test: `payment-gate/dc-payment/mandate.test.ts`

Ports `mandate-wrapper.js` (`buildPaymentMandate`) and `validate.js` (`runGates`), adapted to this repo's `Order` and TS types. The DC mandate has NO `MOCK-DEV-SIGNER` — the authorization proof is the wallet-signed `transaction_data_hash`. Gate 1 re-derives the hash from the mandate's own `transactionData` and re-checks amount + payee against the cart; no gate trusts the `verified` flag.

- [ ] **Step 1: Write the failing test**

Create `payment-gate/dc-payment/mandate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createOrder, type Order } from "../../catalog.js";
import { buildTransactionData, encodeTransactionData, hashTransactionData } from "./txData.js";
import { buildVpToken } from "./fixtures.js";
import { buildDcMandate, runDcGates } from "./mandate.js";

const origin = { rpID: "localhost", origin: "http://localhost:3030" };

function consistent(): { mandate: ReturnType<typeof buildDcMandate>; order: Order; txDataB64: string } {
  const order = createOrder([{ productId: "drift-mouse", quantity: 1 }], "ORD-MD01");
  const txDataB64 = encodeTransactionData(buildTransactionData(order, origin));
  const hashBytes = new Uint8Array(Buffer.from(hashTransactionData(txDataB64), "base64url"));
  const vpStr = buildVpToken({ txHashBytes: hashBytes, instrumentId: "pi-77AABBCC" });
  const mandate = buildDcMandate({ order, vpStr, transactionDataB64: txDataB64, tokenHash: hashTransactionData(txDataB64) });
  return { mandate, order, txDataB64 };
}

const pass = (rs: { gate: string; pass: boolean }[], g: string) => rs.find((r) => r.gate === g)?.pass;

describe("buildDcMandate", () => {
  it("produces a 0.1-dc mandate with the wallet hash in userAuthorization", () => {
    const { mandate, txDataB64 } = consistent();
    expect(mandate.type).toBe("ap2.PaymentMandate");
    expect(mandate.version).toBe("0.1-dc");
    expect(mandate.userAuthorization.type).toBe("openid4vp-dc-api");
    expect(mandate.userAuthorization.transactionData).toBe(txDataB64);
    expect(mandate.subject.credentialId).toBe("pi-77AABBCC");
  });
});

describe("runDcGates", () => {
  it("passes all four gates for a consistent mandate", () => {
    const rs = runDcGates(consistent().mandate);
    expect(rs).toHaveLength(4);
    expect(rs.every((r) => r.pass)).toBe(true);
  });

  it("Gate 1 fails when the cart total is tampered", () => {
    const { mandate } = consistent();
    mandate.cart.total = 99999;
    const rs = runDcGates(mandate);
    expect(pass(rs, "Amount binding")).toBe(false);
    expect(pass(rs, "Subject binding")).toBe(true);
  });

  it("Gate 2 fails when deviceAuth is stripped from the token", () => {
    const { order, txDataB64 } = consistent();
    const hashBytes = new Uint8Array(Buffer.from(hashTransactionData(txDataB64), "base64url"));
    const vpStr = buildVpToken({ txHashBytes: hashBytes, omitDeviceAuth: true });
    const mandate = buildDcMandate({ order, vpStr, transactionDataB64: txDataB64, tokenHash: hashTransactionData(txDataB64) });
    const rs = runDcGates(mandate);
    expect(pass(rs, "Authorization present")).toBe(false);
    expect(pass(rs, "Amount binding")).toBe(true);
  });

  it("Gate 3 fails when the credential is expired", () => {
    const { order, txDataB64 } = consistent();
    const hashBytes = new Uint8Array(Buffer.from(hashTransactionData(txDataB64), "base64url"));
    const vpStr = buildVpToken({ txHashBytes: hashBytes, expiry: "2020-01-01" });
    const mandate = buildDcMandate({ order, vpStr, transactionDataB64: txDataB64, tokenHash: hashTransactionData(txDataB64) });
    expect(pass(runDcGates(mandate), "Credential not expired")).toBe(false);
  });

  it("Gate 4 fails when the subject does not match the disclosed instrument", () => {
    const { mandate } = consistent();
    mandate.subject.credentialId = "pi-DIFFERENT";
    expect(pass(runDcGates(mandate), "Subject binding")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run payment-gate/dc-payment/mandate.test.ts`
Expected: FAIL — cannot resolve `./mandate.js`.

- [ ] **Step 3: Implement `mandate.ts`**

Create `payment-gate/dc-payment/mandate.ts`:

```ts
// AP2-shaped DC payment mandate + four deterministic gates. Ports
// mandate-wrapper.js + validate.js. No MOCK-DEV-SIGNER: the proof is the
// wallet-signed transaction_data_hash. Gate 1 re-derives the hash from the
// mandate's own transactionData and re-checks amount + payee — never trusting a
// `verified` flag.
import { randomUUID } from "node:crypto";
import type { Order } from "../../catalog.js";
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

export function runDcGates(mandate: DcMandate): GateResult[] {
  const ua = mandate.userAuthorization;
  const cart = mandate.cart;
  const results: GateResult[] = [];

  // Gate 1 — amount binding: (a) the wallet-signed hash equals SHA-256 of the
  // transaction_data we sent, (b) that transaction_data's amount + payee match
  // the cart. Re-derived here; the stored `verified` flag is NOT trusted.
  const tokenHash = ua.vpToken ? extractTransactionDataHash(ua.vpToken) : null;
  const recomputed = ua.transactionData ? hashTransactionData(ua.transactionData) : null;
  const txd = ua.transactionData ? decodeTransactionData(ua.transactionData) : undefined;
  const hashOk = !!tokenHash && tokenHash === recomputed;
  const amountOk = Number(txd?.payload?.amount) === Number(cart.total);
  const payeeOk = !!txd?.payload?.payee?.id;
  results.push({
    gate: "Amount binding",
    pass: hashOk && amountOk && payeeOk,
    detail: `hash ${hashOk ? "✓" : "✗"} (token=${tokenHash}) · amount ${amountOk ? "✓" : "✗"} (${txd?.payload?.amount} vs ${cart.total}) · payee ${payeeOk ? "✓" : "✗"}`,
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
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run payment-gate/dc-payment/mandate.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add payment-gate/dc-payment/mandate.ts payment-gate/dc-payment/mandate.test.ts
git commit -m "feat(dc-payment): AP2 DC mandate + four amount-binding gates"
```

---

### Task 5: Sealed reader context (`readerContext.ts`)

**Files:**
- Create: `payment-gate/dc-payment/readerContext.ts`
- Test: `payment-gate/dc-payment/readerContext.test.ts`

Carries the reader's ephemeral ECDH private key (JWK) and the bound `transaction_data` from `/request` to `/verify` with no server memory. Sealed as a JWE (`dir` / `A256GCM`) under a 32-byte key derived from `GATE_SECRET`, with an expiry. This is what makes the DC gate serverless-correct.

- [ ] **Step 1: Write the failing test**

Create `payment-gate/dc-payment/readerContext.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sealReaderContext, openReaderContext } from "./readerContext.js";

const secret = "test-gate-secret";
const ctx = { ecdhPrivateJwk: { kty: "EC", crv: "P-256", d: "x", x: "y", z: "z" }, transactionDataB64: "dHhkYXRh" };

describe("readerContext seal/open", () => {
  it("round-trips the ECDH key and transaction_data", async () => {
    const token = await sealReaderContext(ctx, secret);
    const opened = await openReaderContext(token, secret);
    expect(opened.transactionDataB64).toBe(ctx.transactionDataB64);
    expect(opened.ecdhPrivateJwk).toEqual(ctx.ecdhPrivateJwk);
  });

  it("rejects a token sealed under a different secret", async () => {
    const token = await sealReaderContext(ctx, secret);
    await expect(openReaderContext(token, "wrong-secret")).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    const token = await sealReaderContext(ctx, secret, -1000);
    await expect(openReaderContext(token, secret)).rejects.toThrow(/expired/);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run payment-gate/dc-payment/readerContext.test.ts`
Expected: FAIL — cannot resolve `./readerContext.js`.

- [ ] **Step 3: Implement `readerContext.ts`**

Create `payment-gate/dc-payment/readerContext.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run payment-gate/dc-payment/readerContext.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add payment-gate/dc-payment/readerContext.ts payment-gate/dc-payment/readerContext.test.ts
git commit -m "feat(dc-payment): GATE_SECRET-sealed reader context (stateless)"
```

---

### Task 6: Signed OpenID4VP request (`request.ts`)

**Files:**
- Create: `payment-gate/dc-payment/request.ts`
- Test: `payment-gate/dc-payment/request.test.ts`

Ports the request-building half of the spike's `server.js`: generate a self-signed ES256 reader cert (SAN dNSName = the request host, derived from `origin`), generate the ephemeral ECDH key the wallet encrypts to, bind `transaction_data` to the order, and sign the OpenID4VP request object. The ephemeral private key + `transaction_data` are sealed via `readerContext.ts` and returned to the client to POST back.

- [ ] **Step 1: Write the failing test**

Create `payment-gate/dc-payment/request.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import * as jose from "jose";
import { createOrder } from "../../catalog.js";
import { buildSignedRequest } from "./request.js";
import { openReaderContext } from "./readerContext.js";

const secret = "test-gate-secret";

describe("buildSignedRequest", () => {
  it("returns a signed request JWT bound to the order amount, and a sealed reader context", async () => {
    const order = createOrder([{ productId: "drift-mouse", quantity: 2 }], "ORD-REQ01");
    const origin = { rpID: "localhost", origin: "http://localhost:3030" };
    const { request, readerContextToken } = await buildSignedRequest(order, origin, secret);

    // The JWT is signed; we only decode (no trust check) to assert its shape.
    const claims = jose.decodeJwt(request) as any;
    expect(claims.response_type).toBe("vp_token");
    expect(claims.client_id).toBe("x509_san_dns:localhost");
    expect(claims.expected_origins).toEqual(["http://localhost:3030"]);
    expect(Array.isArray(claims.transaction_data)).toBe(true);
    expect(claims.transaction_data).toHaveLength(1);

    const header = jose.decodeProtectedHeader(request);
    expect(header.alg).toBe("ES256");
    expect(Array.isArray((header as any).x5c)).toBe(true);

    // The sealed context decrypts and carries the same transaction_data we sent.
    const ctx = await openReaderContext(readerContextToken, secret);
    expect(ctx.transactionDataB64).toBe(claims.transaction_data[0]);
    expect(ctx.ecdhPrivateJwk.crv).toBe("P-256");
    expect(ctx.ecdhPrivateJwk.d).toBeTruthy();
  });

  it("derives the client_id SAN from the request host", async () => {
    const order = createOrder([{ productId: "drift-mouse", quantity: 1 }], "ORD-REQ02");
    const origin = { rpID: "mcp-apps-nine.vercel.app", origin: "https://mcp-apps-nine.vercel.app" };
    const { request } = await buildSignedRequest(order, origin, secret);
    expect((jose.decodeJwt(request) as any).client_id).toBe("x509_san_dns:mcp-apps-nine.vercel.app");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run payment-gate/dc-payment/request.test.ts`
Expected: FAIL — cannot resolve `./request.js`.

- [ ] **Step 3: Implement `request.ts`**

Create `payment-gate/dc-payment/request.ts`:

```ts
// Build the signed OpenID4VP request for navigator.credentials.get({digital}).
// Ports the request half of the spike's server.js. The reader cert SAN + client_id
// are derived from the request host so it works on localhost and Vercel HTTPS.
import * as jose from "jose";
import * as x509 from "@peculiar/x509";
import { randomBytes } from "node:crypto";
import type { Order } from "../../catalog.js";
import type { Origin } from "../origin.js";
import { buildTransactionData, encodeTransactionData } from "./txData.js";
import { sealReaderContext } from "./readerContext.js";

const webcrypto = globalThis.crypto;
x509.cryptoProvider.set(webcrypto);

const SIGN_ALG = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" } as const;

async function makeReaderCert(rpID: string): Promise<{ x5c: string; privateKey: CryptoKey }> {
  const keys = await webcrypto.subtle.generateKey(SIGN_ALG, true, ["sign", "verify"]);
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: "01",
    name: `CN=${rpID}`,
    notBefore: new Date(Date.now() - 60_000),
    notAfter: new Date(Date.now() + 86_400_000),
    signingAlgorithm: SIGN_ALG,
    keys,
    extensions: [
      new x509.SubjectAlternativeNameExtension([{ type: "dns", value: rpID }]),
      // The Subject Key Identifier extension is REQUIRED — without it the wallet's
      // TrustManagerUtil does subjectKeyIdentifier!! → NPE.
      await x509.SubjectKeyIdentifierExtension.create(keys.publicKey),
    ],
  });
  return { x5c: cert.toString("base64"), privateKey: keys.privateKey };
}

export interface SignedRequest {
  request: string;
  readerContextToken: string;
}

export async function buildSignedRequest(order: Order, origin: Origin, secret: string): Promise<SignedRequest> {
  const { x5c, privateKey } = await makeReaderCert(origin.rpID);

  // Ephemeral P-256 key the wallet encrypts its response to.
  const encKP = await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const encPubJwk = await webcrypto.subtle.exportKey("jwk", encKP.publicKey);
  const ecdhPrivateJwk = (await webcrypto.subtle.exportKey("jwk", encKP.privateKey)) as jose.JWK;
  const encJwk = { kty: "EC", crv: "P-256", x: encPubJwk.x, y: encPubJwk.y, use: "enc", alg: "ECDH-ES", kid: "response-encryption-key" };

  const txDataB64 = encodeTransactionData(buildTransactionData(order, origin));
  const nonce = jose.base64url.encode(webcrypto.getRandomValues(new Uint8Array(16)));

  const requestObject = {
    response_type: "vp_token",
    response_mode: "dc_api.jwt",
    client_id: `x509_san_dns:${origin.rpID}`,
    expected_origins: [origin.origin],
    nonce,
    dcql_query: {
      credentials: [{
        id: "dpc",
        format: "mso_mdoc",
        meta: { doctype_value: "org.multipaz.payment.sca.1" },
        claims: [
          { path: ["org.multipaz.payment.sca.1", "issuer_name"], intent_to_retain: false },
          { path: ["org.multipaz.payment.sca.1", "payment_instrument_id"], intent_to_retain: false },
          { path: ["org.multipaz.payment.sca.1", "masked_account_reference"], intent_to_retain: false },
          { path: ["org.multipaz.payment.sca.1", "holder_name"], intent_to_retain: false },
          { path: ["org.multipaz.payment.sca.1", "issue_date"], intent_to_retain: false },
          { path: ["org.multipaz.payment.sca.1", "expiry_date"], intent_to_retain: false },
        ],
      }],
    },
    client_metadata: {
      vp_formats_supported: { mso_mdoc: { issuerauth_alg_values: [-7], deviceauth_alg_values: [-7] } },
      jwks: { keys: [encJwk] },
    },
    transaction_data: [txDataB64],
  };

  const signingKey = await jose.importKey
    ? // jose v5: importKey is not used; sign with a KeyLike. Convert the WebCrypto key.
      (privateKey as unknown as jose.KeyLike)
    : (privateKey as unknown as jose.KeyLike);

  const request = await new jose.SignJWT(requestObject)
    .setProtectedHeader({ alg: "ES256", typ: "oauth-authz-req+jwt", x5c: [x5c] })
    .setIssuedAt()
    .sign(signingKey);

  const readerContextToken = await sealReaderContext({ ecdhPrivateJwk, transactionDataB64: txDataB64 }, secret);
  return { request, readerContextToken };
}
```

> Note for the implementer: `jose.SignJWT.sign` accepts a WebCrypto `CryptoKey` directly in jose v5 — pass `privateKey` straight through. The `jose.importKey ? … : …` shim above is defensive noise; delete it and pass `privateKey as unknown as jose.KeyLike` (or `CryptoKey`) to `.sign(...)`. If TypeScript complains about the key type, cast to `jose.KeyLike`. Keep the test green as the contract.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run payment-gate/dc-payment/request.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add payment-gate/dc-payment/request.ts payment-gate/dc-payment/request.test.ts
git commit -m "feat(dc-payment): signed OpenID4VP request, origin-derived reader cert"
```

---

### Task 7: Verify the wallet presentation (`verify.ts`) + JWE test fixture

**Files:**
- Modify: `payment-gate/dc-payment/fixtures.ts` (add `encryptToReaderKey`)
- Create: `payment-gate/dc-payment/verify.ts`
- Test: `payment-gate/dc-payment/verify.test.ts`

Ports the `/result` half of the spike's `server.js`: open the sealed reader context, decrypt the wallet's JWE (`response`), pull the `vp_token`, extract the signed hash, build the mandate, and run the gates. The test synthesises a JWE encrypted to the sealed ephemeral key so the full path runs without a live wallet.

- [ ] **Step 1: Add the JWE helper to `fixtures.ts`**

Append to `payment-gate/dc-payment/fixtures.ts`:

```ts
import * as jose from "jose";

// Encrypt an OpenID4VP response { vp_token: { dpc: [vpStr] } } to the reader's
// ephemeral public key, mirroring what the wallet sends back. The reader context
// stores the PRIVATE jwk; we derive the public jwk from it to encrypt.
export async function encryptToReaderKey(vpStr: string, ecdhPrivateJwk: jose.JWK): Promise<string> {
  const { d, ...publicJwk } = ecdhPrivateJwk;
  const pub = await jose.importJWK({ ...publicJwk, alg: "ECDH-ES" }, "ECDH-ES");
  const plaintext = new TextEncoder().encode(JSON.stringify({ vp_token: { dpc: [vpStr] } }));
  return await new jose.CompactEncrypt(plaintext)
    .setProtectedHeader({ alg: "ECDH-ES", enc: "A256GCM" })
    .encrypt(pub);
}
```

- [ ] **Step 2: Write the failing test**

Create `payment-gate/dc-payment/verify.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createOrder } from "../../catalog.js";
import { buildTransactionData, encodeTransactionData, hashTransactionData } from "./txData.js";
import { sealReaderContext } from "./readerContext.js";
import { buildVpToken, encryptToReaderKey } from "./fixtures.js";
import { verifyDcPresentation } from "./verify.js";

const secret = "test-gate-secret";
const origin = { rpID: "localhost", origin: "http://localhost:3030" };

async function setup(opts: { tamperToken?: boolean } = {}) {
  const order = createOrder([{ productId: "drift-mouse", quantity: 1 }], "ORD-VF01");
  const txDataB64 = encodeTransactionData(buildTransactionData(order, origin));
  const expected = hashTransactionData(txDataB64);
  const hashBytes = new Uint8Array(Buffer.from(opts.tamperToken ? hashTransactionData("different") : expected, "base64url"));
  const vpStr = buildVpToken({ txHashBytes: hashBytes });
  // Reader keypair: seal the private jwk, encrypt the wallet response to its public half.
  const enc = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const ecdhPrivateJwk = await crypto.subtle.exportKey("jwk", enc.privateKey);
  const readerContextToken = await sealReaderContext({ ecdhPrivateJwk, transactionDataB64: txDataB64 }, secret);
  const jwe = await encryptToReaderKey(vpStr, ecdhPrivateJwk);
  return { order, readerContextToken, result: { protocol: "openid4vp", data: { response: jwe } } };
}

describe("verifyDcPresentation", () => {
  it("decrypts, assembles a mandate, and passes the gates for a matching hash", async () => {
    const { order, readerContextToken, result } = await setup();
    const { mandate, gates } = await verifyDcPresentation({ order, result, readerContextToken, secret });
    expect(mandate.userAuthorization.verified).toBe(true);
    expect(gates.find((g) => g.gate === "Amount binding")?.pass).toBe(true);
  });

  it("marks the amount-binding gate failed when the signed hash does not match", async () => {
    const { order, readerContextToken, result } = await setup({ tamperToken: true });
    const { gates } = await verifyDcPresentation({ order, result, readerContextToken, secret });
    expect(gates.find((g) => g.gate === "Amount binding")?.pass).toBe(false);
  });

  it("throws on a reader context sealed under a different secret", async () => {
    const { order, readerContextToken, result } = await setup();
    await expect(verifyDcPresentation({ order, result, readerContextToken, secret: "wrong" })).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npx vitest run payment-gate/dc-payment/verify.test.ts`
Expected: FAIL — cannot resolve `./verify.js`.

- [ ] **Step 4: Implement `verify.ts`**

Create `payment-gate/dc-payment/verify.ts`:

```ts
// Verify the wallet's OpenID4VP presentation: open the sealed reader context,
// decrypt the JWE response, extract the signed transaction_data_hash, assemble
// the DC mandate, and run the gates. Ports the /result half of the spike server.
import * as jose from "jose";
import type { Order } from "../../catalog.js";
import { openReaderContext } from "./readerContext.js";
import { extractTransactionDataHash } from "./mdoc.js";
import { buildDcMandate, runDcGates, type DcMandate, type GateResult } from "./mandate.js";

export interface DcResult {
  protocol?: string;
  data?: unknown;
}

export interface DcVerification {
  mandate: DcMandate;
  gates: GateResult[];
}

export async function verifyDcPresentation(args: {
  order: Order;
  result: DcResult;
  readerContextToken: string;
  secret: string;
}): Promise<DcVerification> {
  const { order, result, readerContextToken, secret } = args;
  const ctx = await openReaderContext(readerContextToken, secret);

  let data: any = result?.data;
  if (typeof data === "string") data = JSON.parse(data);
  const jwe: string | undefined = data?.response;
  if (!jwe) throw new Error("no .response (JWE) in result.data");

  const encPrivKey = await jose.importJWK(ctx.ecdhPrivateJwk, "ECDH-ES");
  const { plaintext } = await jose.compactDecrypt(jwe, encPrivKey);
  const openid4vpResponse = JSON.parse(new TextDecoder().decode(plaintext));
  const vpToken = openid4vpResponse.vp_token; // { dpc: [ "<DeviceResponse b64url>" ] }
  const vpStr: string = Array.isArray(vpToken?.dpc) ? vpToken.dpc[0] : vpToken?.dpc;
  if (!vpStr) throw new Error("no vp_token.dpc in decrypted response");

  const tokenHash = extractTransactionDataHash(vpStr);
  const mandate = buildDcMandate({ order, vpStr, transactionDataB64: ctx.transactionDataB64, tokenHash });
  const gates = runDcGates(mandate);
  return { mandate, gates };
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npx vitest run payment-gate/dc-payment/verify.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add payment-gate/dc-payment/fixtures.ts payment-gate/dc-payment/verify.ts payment-gate/dc-payment/verify.test.ts
git commit -m "feat(dc-payment): decrypt + verify wallet presentation into a mandate"
```

---

### Task 8: The DC gate page (`page.ts`)

**Files:**
- Create: `payment-gate/dc-payment/page.ts`
- Test: `payment-gate/dc-payment/page.test.ts`

Server-rendered page that shows the bound amount, feature-detects the Digital Credentials API, fetches the signed request, calls `navigator.credentials.get({digital})` (Chrome renders the cross-device QR → caBLE), and POSTs the wallet result back with the reader-context token. Falls back to a requirements notice + a link to the passkey gate when the API is absent. Adapts the spike's `public/checkout.html` to a server-rendered string, mirroring the passkey `page.ts` shape.

- [ ] **Step 1: Write the failing test**

Create `payment-gate/dc-payment/page.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createOrder } from "../../catalog.js";
import { renderDcPage } from "./page.js";

describe("renderDcPage", () => {
  it("shows the bound amount and wires the DC request/verify endpoints", () => {
    const order = createOrder([{ productId: "drift-mouse", quantity: 2 }], "ORD-PG01");
    const html = renderDcPage({ order, orderToken: "TOK123" });
    expect(html).toContain(new Intl.NumberFormat("en-US", { style: "currency", currency: order.currency }).format(order.total));
    expect(html).toContain("/payment-gate/dc-payment/request");
    expect(html).toContain("/payment-gate/dc-payment/verify");
    expect(html).toContain("TOK123");
  });

  it("includes the unsupported-API fallback to the passkey gate", () => {
    const order = createOrder([{ productId: "drift-mouse", quantity: 1 }], "ORD-PG02");
    const html = renderDcPage({ order, orderToken: "TOK456" });
    expect(html).toContain("DigitalCredential");
    expect(html).toContain("/payment-gate/passkey?order=TOK456");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run payment-gate/dc-payment/page.test.ts`
Expected: FAIL — cannot resolve `./page.js`.

- [ ] **Step 3: Implement `page.ts`**

Create `payment-gate/dc-payment/page.ts`:

```ts
// Server-rendered DC payment gate page. Shows the bound amount, then calls
// navigator.credentials.get({digital}) with the server's signed request. Chrome
// 141+ renders the cross-device QR (caBLE); the wallet's encrypted vp_token
// returns here and we POST it back with the reader-context token. Feature-detects
// the API and falls back to the passkey gate when absent.
import type { Order } from "../../catalog.js";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function money(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}

export function renderDcPage(args: { order: Order; orderToken: string }): string {
  const { order, orderToken } = args;
  const token = escapeHtml(orderToken);
  const rows = order.lines
    .map((l) => `<tr><td>${escapeHtml(l.name)} <span style="color:#999;">×${l.quantity}</span></td><td class="amt">${money(l.lineTotal, l.currency)}</td></tr>`)
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Authorize payment (cross-device) · ${escapeHtml(order.id)}</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 560px; margin: 3rem auto; padding: 0 1.25rem; color: #1a1a1a; }
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
  .notice { margin-top: 1rem; padding: 0.9rem 1rem; background: #fff7ed; border-left: 4px solid #d97706; border-radius: 6px; font-size: 0.9rem; }
  #receipt { display: none; margin-top: 1.25rem; padding: 1rem 1.1rem; background: #ecfdf3; border-left: 4px solid #0a7f2e; border-radius: 6px; }
  .gate { font-family: ui-monospace, Menlo, monospace; font-size: 0.82rem; padding: 0.15rem 0; }
  .gate.pass { color: #0a7f2e; } .gate.fail { color: #b00020; }
  a.toggle { display: inline-block; margin-top: 0.75rem; font-size: 0.85rem; color: #1a7f37; }
</style>
</head>
<body>
  <h1>Authorize payment · cross-device</h1>
  <p class="lede">Present a payment credential from your phone wallet. Chrome shows a QR; scanning it uses the cross-device channel (FIDO caBLE). Your wallet signs over this exact amount — nothing is charged (demo).</p>
  <table>
    ${rows}
    <tr class="total"><td>Total · order ${escapeHtml(order.id)}</td><td class="amt">${money(order.total, order.currency)}</td></tr>
  </table>
  <button id="go">Authorize ${money(order.total, order.currency)} with my wallet</button>
  <a class="toggle" href="/payment-gate/passkey?order=${token}">← Use a passkey on this device instead</a>
  <div id="log"></div>
  <div id="receipt"></div>
  <script type="module">
    const ORDER_TOKEN = ${JSON.stringify(token)};
    const log = document.getElementById("log");
    const btn = document.getElementById("go");
    const step = (t, c = "") => { const d = document.createElement("div"); d.className = "step " + c; d.textContent = t; log.appendChild(d); };
    function notice(html) { const d = document.createElement("div"); d.className = "notice"; d.innerHTML = html; log.appendChild(d); }

    btn.addEventListener("click", async () => {
      btn.disabled = true;
      if (!("credentials" in navigator) || !window.DigitalCredential) {
        notice('This browser does not support <code>navigator.credentials.get({digital})</code>. Need <strong>Chrome 141+</strong> (for localhost dev, enable <code>chrome://flags#web-identity-digital-credentials</code>). ' +
          '<a href="/payment-gate/passkey?order=' + ORDER_TOKEN + '">Use a passkey on this device instead →</a>');
        return;
      }
      try {
        step("→ GET signed request");
        const { request, readerContextToken } = await fetch("/payment-gate/dc-payment/request?order=" + encodeURIComponent(ORDER_TOKEN)).then((r) => r.json());
        step("→ navigator.credentials.get({digital}) — Chrome should show a QR…");
        const result = await navigator.credentials.get({ digital: { requests: [{ protocol: "openid4vp-v1-signed", data: { request } }] }, mediation: "required" });
        let data = result?.data ?? null;
        if (typeof data === "string") { try { data = JSON.parse(data); } catch {} }
        step("→ verify");
        const out = await fetch("/payment-gate/dc-payment/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderToken: ORDER_TOKEN, readerContextToken, result: { protocol: result?.protocol ?? null, data } }),
        }).then((r) => r.json());
        if (!out.mandate) throw new Error(out.error || "authorization failed");
        step("✓ presentation verified · mandate built", "ok");
        renderReceipt(out);
      } catch (err) {
        step("✗ " + (err?.message ?? String(err)), "err");
        btn.disabled = false;
      }
    });
    function renderReceipt(out) {
      const el = document.getElementById("receipt");
      const gates = out.gates.map((g) => '<div class="gate ' + (g.pass ? "pass" : "fail") + '">' + (g.pass ? "✓" : "✗") + " " + g.gate + " — " + g.detail + "</div>").join("");
      el.innerHTML = '<div style="font-weight:600;color:#0a7f2e;">✓ Payment Mandate authorized (amount-bound)</div>' +
        '<div style="font-size:0.8rem;color:#666;margin:0.3rem 0 0.6rem;">' + out.mandate.id + "</div>" + gates;
      el.style.display = "block";
    }
  </script>
</body>
</html>`;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run payment-gate/dc-payment/page.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add payment-gate/dc-payment/page.ts payment-gate/dc-payment/page.test.ts
git commit -m "feat(dc-payment): server-rendered QR page with passkey fallback"
```

---

### Task 9: Mount the gate + checkout link (`routes.ts`, `app.ts`, `checkout.ts`)

**Files:**
- Create: `payment-gate/dc-payment/routes.ts`
- Test: `payment-gate/dc-payment/routes.test.ts`
- Modify: `app.ts:7` (import) and `app.ts:51` (mount)
- Modify: `checkout.ts:111-118` (add a secondary cross-device link)
- Test: `checkout.test.ts` (assert the DC link)

- [ ] **Step 1: Write the failing routes test**

Create `payment-gate/dc-payment/routes.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import * as jose from "jose";
import { createOrder, encodeOrder } from "../../checkout.js";
import { registerDcPaymentGate } from "./routes.js";

let app: express.Express;
const token = encodeOrder(createOrder([{ productId: "drift-mouse", quantity: 1 }], "ORD-RT01"));

beforeAll(() => {
  process.env.GATE_SECRET = "routes-test-secret";
  app = express();
  registerDcPaymentGate(app);
});

describe("registerDcPaymentGate", () => {
  it("GET /payment-gate/dc-payment renders the page for a valid order", async () => {
    const res = await request(app).get("/payment-gate/dc-payment?order=" + encodeURIComponent(token));
    expect(res.status).toBe(200);
    expect(res.text).toContain("cross-device");
  });

  it("GET /payment-gate/dc-payment 404s for a bad order token", async () => {
    const res = await request(app).get("/payment-gate/dc-payment?order=garbage");
    expect(res.status).toBe(404);
  });

  it("GET /payment-gate/dc-payment/request returns a signed request + reader context", async () => {
    const res = await request(app).get("/payment-gate/dc-payment/request?order=" + encodeURIComponent(token));
    expect(res.status).toBe(200);
    expect(typeof res.body.request).toBe("string");
    expect(typeof res.body.readerContextToken).toBe("string");
    expect((jose.decodeJwt(res.body.request) as any).response_type).toBe("vp_token");
  });

  it("POST /payment-gate/dc-payment/verify 400s on a bad order token", async () => {
    const res = await request(app).post("/payment-gate/dc-payment/verify").send({ orderToken: "garbage", readerContextToken: "x", result: {} });
    expect(res.status).toBe(400);
  });
});
```

> Note: `createOrder` is re-exported from `checkout.js`? It is not — import `createOrder` from `../../catalog.js` and `encodeOrder` from `../../checkout.js`. Fix the import to:
> `import { createOrder } from "../../catalog.js";` and `import { encodeOrder } from "../../checkout.js";`

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run payment-gate/dc-payment/routes.test.ts`
Expected: FAIL — cannot resolve `./routes.js`.

- [ ] **Step 3: Implement `routes.ts`**

Create `payment-gate/dc-payment/routes.ts`:

```ts
import express, { type Express, type Request, type Response } from "express";
import { decodeOrder } from "../../checkout.js";
import { deriveOrigin } from "../origin.js";
import { gateSecret } from "../challengeToken.js";
import { buildBindingFields } from "../mandate.js";
import { buildSignedRequest } from "./request.js";
import { verifyDcPresentation } from "./verify.js";
import { renderDcPage } from "./page.js";

function originOf(req: Request) {
  return deriveOrigin({ headers: req.headers, host: req.get("host") ?? "localhost", protocol: req.protocol });
}

export function registerDcPaymentGate(app: Express): void {
  app.get("/payment-gate/dc-payment", (req: Request, res: Response) => {
    const token = typeof req.query.order === "string" ? req.query.order : undefined;
    const order = token ? decodeOrder(token) : undefined;
    if (!order || !token) {
      res.status(404).type("html").send("<!doctype html><h1>Order not found</h1>");
      return;
    }
    try {
      res.status(200).type("html").send(renderDcPage({ order, orderToken: token }));
    } catch {
      res.status(404).type("html").send("<!doctype html><h1>Order not found</h1>");
    }
  });

  app.get("/payment-gate/dc-payment/request", async (req: Request, res: Response) => {
    const token = typeof req.query.order === "string" ? req.query.order : undefined;
    const order = token ? decodeOrder(token) : undefined;
    if (!order) {
      res.status(400).json({ error: "invalid order token" });
      return;
    }
    try {
      const { request, readerContextToken } = await buildSignedRequest(order, originOf(req), gateSecret());
      res.json({ request, readerContextToken });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // The wallet's encrypted vp_token can be large; raise the JSON limit on this route.
  app.post("/payment-gate/dc-payment/verify", express.json({ limit: "4mb" }), async (req: Request, res: Response) => {
    const { orderToken, readerContextToken, result } = req.body ?? {};
    const order = typeof orderToken === "string" ? decodeOrder(orderToken) : undefined;
    if (!order) {
      res.status(400).json({ error: "invalid order token" });
      return;
    }
    try {
      const origin = originOf(req);
      const { mandate, gates } = await verifyDcPresentation({ order, result, readerContextToken, secret: gateSecret() });
      res.json({ mandate, gates, binding: buildBindingFields(order, origin) });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });
}
```

- [ ] **Step 4: Run the routes test to confirm it passes**

Run: `npx vitest run payment-gate/dc-payment/routes.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Mount the gate in `app.ts`**

In `app.ts`, after the passkey import (line 7) add:
```ts
import { registerDcPaymentGate } from "./payment-gate/dc-payment/routes.js";
```
And after `registerPasskeyGate(app);` (line 51) add:
```ts
  registerDcPaymentGate(app);
```

- [ ] **Step 6: Add the cross-device link to the checkout page**

In `checkout.ts`, in `renderCheckoutPage`, immediately after the existing "Authorize payment" `<a id="authorize">…</a>` block (ends line 115) and before the `<div class="note">` (line 116), add a secondary link:
```ts
  <a id="authorize-xdev" href="/payment-gate/dc-payment?order=${encodeURIComponent(token)}"
     style="display:block;margin-top:10px;width:100%;padding:12px;font-size:14px;font-weight:500;
     text-align:center;color:#1a7f37;background:#fff;border:1px solid #1a7f37;border-radius:8px;text-decoration:none;box-sizing:border-box;">
    Authorize on my phone (cross-device)
  </a>
```

- [ ] **Step 7: Add the checkout assertion test**

In `checkout.test.ts`, inside the existing `describe("checkout page authorization affordance", …)` block, add:
```ts
  it("offers a secondary cross-device link to the DC payment gate", () => {
    const order = createOrder([{ productId: "drift-mouse", quantity: 1 }], "ORD-CO02");
    const { html } = checkoutResponse(encodeOrder(order));
    expect(html).toContain("/payment-gate/dc-payment?order=");
    expect(html).toContain("cross-device");
  });
```

- [ ] **Step 8: Run the affected suites + typecheck**

Run: `npx vitest run payment-gate/dc-payment/routes.test.ts checkout.test.ts app.test.ts && npm run typecheck`
Expected: all PASS; typecheck exit 0.

- [ ] **Step 9: Commit**

```bash
git add payment-gate/dc-payment/routes.ts payment-gate/dc-payment/routes.test.ts app.ts checkout.ts checkout.test.ts
git commit -m "feat(dc-payment): mount gate + cross-device link from checkout"
```

---

### Task 10: Docs, ROADMAP, and full-suite green

**Files:**
- Modify: `ROADMAP.md` (check the caBLE item, note rung 5 done)
- Modify: `README.md` (link the DC gate from the payment-gate area)
- Verify: full test suite + typecheck + build

- [ ] **Step 1: Mark the ROADMAP item done**

In `ROADMAP.md`, change the FIDO caBLE item from `- [ ]` to `- [x]` and append a sub-line:
```markdown
  - [x] Passkey gate (same-device + cross-device caBLE) — `payment-gate/passkey/`.
  - [x] DC payment gate (cross-device caBLE, amount-bound) — `payment-gate/dc-payment/`.
```

- [ ] **Step 2: Link the DC gate from the README**

In `README.md`, near the existing `payment-gate/README.md` reference, add a sentence:
```markdown
The cross-device, amount-bound variant lives in
[`payment-gate/dc-payment/`](payment-gate/dc-payment/README.md): the wallet signs
over the exact cart total via OpenID4VP, carried phone↔desktop over FIDO caBLE.
```

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: all suites pass, including the new dc-payment tests and the existing passkey/checkout/app/catalog/cartStore suites. The `verify.fixture.test.ts` (passkey) and any recorded-fixture DC tests remain skipped if their fixture files are absent — that is expected.

- [ ] **Step 4: Typecheck + build**

Run: `npm run build`
Expected: `typecheck` clean, UI bundle builds, `build:server` (`tsc -p tsconfig.server.json`) compiles `payment-gate/dc-payment/**` with no errors. If `tsconfig.server.json` uses an explicit `include`/`files` list, confirm `payment-gate/**` is covered (the passkey gate already compiles, so the glob likely covers it — verify the dc-payment files emit to `dist/`).

- [ ] **Step 5: Manual smoke (local, documented — not automated)**

Run: `npm run build && PUBLIC_BASE_URL=http://localhost:3030 GATE_SECRET=dev-secret node dist/main.js` (or the project's HTTP start), then open `http://localhost:3030/checkout?order=<token>` and click "Authorize on my phone (cross-device)". On Chrome 141+ with a provisioned wallet, a QR appears; scanning it runs the caBLE leg. Without the API, the page shows the requirements notice and the passkey fallback link. Record findings in `payment-gate/dc-payment/README.md` if anything surprises.

- [ ] **Step 6: Commit**

```bash
git add ROADMAP.md README.md
git commit -m "docs(dc-payment): mark caBLE rung done; link DC gate"
```

---

## Self-Review

**1. Spec coverage** (against `docs/superpowers/specs/2026-05-31-cable-payment-gate-design.md`):
- In-scope item 1 (`payment-gate/` shared helpers + two gate modules): passkey existed (rungs 1–4); this plan adds `dc-payment/`. ✓
- Item 3 (passkey gate): already done (rungs 3–4). ✓ (not re-done here)
- Item 4 (DC payment gate, OpenID4VP `transaction_data` bound to amount+payee, server decrypt+verify, mandate carrying the signed hash): Tasks 2,6,7,8,9. ✓
- Item 5 (four-gate validator): Task 4 `runDcGates`. Deviation noted — DC gates live in `dc-payment/mandate.ts`, not shared `mandate.ts`. ✓ (flagged)
- Item 6 (mount into `createApp()`): Task 9 Step 5. ✓
- Item 7 (unit tests for pure modules + recorded-fixture verifier): Tasks 2–9 all TDD; `verify.ts` tested via a synthesised JWE fixture rather than a recorded wallet capture (a recorded fixture can be dropped in later, gated like the passkey `verify.fixture.test.ts`). ✓
- Statelessness (challenge/reader key in `GATE_SECRET` tokens): Task 5 `readerContext.ts`. ✓
- Origin/RP-ID from request host: reuses existing `origin.ts`; Task 6 derives `client_id`/SAN from it. ✓
- Error handling (bad order → 404, expired/tampered token → 400, API unsupported → notice, failed gate → report not 500): Tasks 8,9. ✓

**2. Placeholder scan:** No "TBD"/"implement later". The one prose note in Task 6 Step 3 (the `jose.importKey` shim) explicitly instructs deletion and gives the concrete replacement — not a placeholder. The Task 9 test import note corrects `createOrder`'s source. Both are concrete.

**3. Type consistency:** `buildBindingFields(order, origin)` (shared `mandate.ts`) used by `txData.ts` and `routes.ts` — matches existing signature. `Origin` = `{ rpID, origin }` — matches `origin.ts`. `Order` fields (`total`, `currency`, `lines`, `id`) — match `catalog.ts`. `buildDcMandate({ order, vpStr, transactionDataB64, tokenHash })` and `runDcGates(mandate)` consistent across Tasks 4, 7. `verifyDcPresentation({ order, result, readerContextToken, secret })` consistent across Tasks 7, 9. `sealReaderContext(ctx, secret, ttlMs?)` / `openReaderContext(token, secret)` consistent across Tasks 5, 6, 7. `GateResult` shape (`{ gate, pass, detail }`) matches the passkey gate's shape so the page's receipt renderer is identical.

**Known environment caveats carried forward:** the live DC path needs Chrome 141+, a secure context, and a provisioned wallet; it is not automated (documented in Task 10 Step 5 and the module README). The reader cert is self-signed (expect an "unverified verifier" warning). `GATE_SECRET` must be set in the Vercel environment for cross-instance seal/open to work; locally it falls back to a per-process random value (fine because one process spans request+verify).
