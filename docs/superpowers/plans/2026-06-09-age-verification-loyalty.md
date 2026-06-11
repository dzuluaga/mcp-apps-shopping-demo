# Age Verification + Loyalty Discount Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate checkout on a digital age-verification credential when the cart contains alcohol, and apply an optional 10% loyalty discount when a loyalty credential is presented — all inside the existing Product Picker MCP app.

**Architecture:** Reuse the repo's existing pattern: the React widget opens a browser **gate page** (`/credential-gate/age`, `/credential-gate/loyalty`) which runs `navigator.credentials.get({digital})` (OpenID4VP, ported from `payment-gate/dc-payment/`) with an **instant-demo fallback**, writes the result to a new demo-global `verificationStore`, and the widget polls a status endpoint then refreshes the cart. Age/loyalty/discount state is folded into the `PricedCart` payload every cart tool already returns.

**Tech Stack:** TypeScript (Node ESM), Express 5, `@modelcontextprotocol/sdk` + `ext-apps`, React 19, Vite, Vitest + supertest, `jose`, `@peculiar/x509`, `cbor-x`, Upstash Redis.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `catalog.ts` (modify) | Alcohol products, `ageRestricted`, `LOYALTY_DISCOUNT_PCT`, `PricedCart` discount fields, `priceCart`/`createOrder` opts, `Order` discount fields |
| `verificationStore.ts` (create) | Demo-global age + loyalty state (Memory/Redis), mirrors `cartStore.ts` |
| `payment-gate/credential-gate/dcql.ts` (create) | DCQL builders for `age` and `loyalty` credentials |
| `payment-gate/credential-gate/verify.ts` (create) | Evaluate disclosed claims → verified bool (+ membership number), tiered fallback |
| `payment-gate/credential-gate/request.ts` (create) | Signed OpenID4VP request for a credential DCQL (no payment txData) |
| `payment-gate/dc-payment/request.ts` (modify) | Export shared `makeReaderCert` + `makeEncryptionKey` helpers |
| `payment-gate/credential-gate/page.ts` (create) | Render age/loyalty gate page (real DC + instant-demo button) |
| `payment-gate/credential-gate/routes.ts` (create) | `registerCredentialGate(app)` — page, request, verify, demo endpoints |
| `app.ts` (modify) | Register credential gate + `GET /checkout/verification-status` |
| `server.ts` (modify) | Price funcs read store; `verify-age`/`apply-loyalty`/`get-verification-status` tools; `checkout` age guard; `browse-products` text |
| `src/app.tsx` (modify) | `21+` badge, disabled Checkout, verify/loyalty buttons, discount line, polling, standalone mocks |
| `checkout.ts` (modify) | Order discount fields surface on checkout page |

Test files live next to their module (repo convention): `catalog.test.ts`, `verificationStore.test.ts`, `payment-gate/credential-gate/dcql.test.ts`, `payment-gate/credential-gate/verify.test.ts`, `app.test.ts` (extended), `server.test.ts` (if present) — and ad-hoc supertest in `app.test.ts`.

Run all tests with `npm run test`. Typecheck with `npm run typecheck`. Build with `npm run build`.

---

## Task 1: Catalog — alcohol products, discount fields, priced cart opts

**Files:**
- Modify: `catalog.ts`
- Test: `catalog.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `catalog.test.ts`:

```ts
import { LOYALTY_DISCOUNT_PCT } from "./catalog.js";

describe("age-restricted catalog", () => {
  it("has at least one age-restricted product", () => {
    expect(CATALOG.some((p) => p.ageRestricted)).toBe(true);
  });
});

describe("priceCart discount + flags", () => {
  const alcohol = CATALOG.find((p) => p.ageRestricted)!;
  const normal = CATALOG.find((p) => !p.ageRestricted)!;

  it("sets hasAgeRestricted when an alcohol item is in the cart", () => {
    const cart = priceCart([{ productId: alcohol.id, quantity: 1 }]);
    expect(cart.hasAgeRestricted).toBe(true);
    const clean = priceCart([{ productId: normal.id, quantity: 1 }]);
    expect(clean.hasAgeRestricted).toBe(false);
  });

  it("applies a 10% whole-cart discount when loyaltyApplied", () => {
    const cart = priceCart([{ productId: normal.id, quantity: 2 }], { loyaltyApplied: true });
    expect(cart.subtotal).toBe(normal.price * 2);
    expect(cart.discount).toBe(Math.round(normal.price * 2 * (LOYALTY_DISCOUNT_PCT / 100) * 100) / 100);
    expect(cart.total).toBe(cart.subtotal - cart.discount);
    expect(cart.loyaltyApplied).toBe(true);
  });

  it("no discount without loyalty; total equals subtotal", () => {
    const cart = priceCart([{ productId: normal.id, quantity: 1 }]);
    expect(cart.discount).toBe(0);
    expect(cart.total).toBe(cart.subtotal);
    expect(cart.loyaltyApplied).toBe(false);
    expect(cart.ageVerified).toBe(false);
  });

  it("reflects ageVerified from opts", () => {
    const cart = priceCart([{ productId: alcohol.id, quantity: 1 }], { ageVerified: true });
    expect(cart.ageVerified).toBe(true);
  });
});

describe("createOrder discount", () => {
  it("snapshots discount + subtotal", () => {
    const normal = CATALOG.find((p) => !p.ageRestricted)!;
    const order = createOrder([{ productId: normal.id, quantity: 2 }], "ORD-DISC01", { loyaltyApplied: true });
    expect(order.subtotal).toBe(normal.price * 2);
    expect(order.discount).toBeGreaterThan(0);
    expect(order.total).toBe(order.subtotal - order.discount);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm run test -- catalog`
Expected: FAIL (`LOYALTY_DISCOUNT_PCT` undefined, `hasAgeRestricted`/`subtotal`/`discount` missing, `priceCart`/`createOrder` don't accept opts).

- [ ] **Step 3: Implement in `catalog.ts`**

Add the constant near the top (after `CART_META_KEY`):

```ts
// Loyalty members get this percentage off the whole cart when they present a
// valid loyalty credential. Whole-cart, mirrors a2ui_concierge.
export const LOYALTY_DISCOUNT_PCT = 10;
```

Add `ageRestricted` to `Product`:

```ts
export interface Product {
  id: string;
  name: string;
  price: number;
  currency: string;
  image: string;
  category: string;
  description: string;
  // Requires an age-verification credential (age_over_21) before checkout.
  ageRestricted?: boolean;
}
```

Replace `PricedCart` with:

```ts
export interface PricedCart {
  lines: PricedCartLine[];
  itemCount: number;
  subtotal: number;
  discount: number;
  total: number;
  currency: string;
  unknownIds: string[];
  // True when any line is age-restricted (alcohol).
  hasAgeRestricted: boolean;
  // Reflects verificationStore at pricing time (false in pure/unit pricing).
  ageVerified: boolean;
  loyaltyApplied: boolean;
}

// Verification flags that influence pricing/gating. Passed by the server from
// verificationStore; defaults to all-false for pure pricing.
export interface PriceOpts {
  ageVerified?: boolean;
  loyaltyApplied?: boolean;
}
```

Add the 3 alcohol products to the end of the `CATALOG` array (before the closing `]`):

```ts
  {
    id: "celebration-champagne",
    name: "Celebration Champagne Gift Set",
    price: 89.0,
    currency: "USD",
    image: "https://picsum.photos/seed/celebration-champagne/400/300",
    category: "Beverages",
    description: "Brut champagne duo with two crystal flutes. 21+ only.",
    ageRestricted: true,
  },
  {
    id: "oak-whiskey",
    name: "Oak Reserve Whiskey Collection",
    price: 124.0,
    currency: "USD",
    image: "https://picsum.photos/seed/oak-whiskey/400/300",
    category: "Beverages",
    description: "Trio of small-batch aged whiskeys. 21+ only.",
    ageRestricted: true,
  },
  {
    id: "craft-beer-sampler",
    name: "Craft Beer Sampler",
    price: 48.0,
    currency: "USD",
    image: "https://picsum.photos/seed/craft-beer-sampler/400/300",
    category: "Beverages",
    description: "Twelve-can sampler of regional craft brews. 21+ only.",
    ageRestricted: true,
  },
```

Add reviews for them in `REVIEWS`:

```ts
  "celebration-champagne": [
    { author: "Nadia P.", rating: 5, title: "Perfect gift", body: "Beautiful set, flutes felt premium and the champagne was crisp." },
    { author: "Leo M.", rating: 4, title: "Lovely", body: "Great for a toast. Packaging was elegant." },
  ],
  "oak-whiskey": [
    { author: "Quinn R.", rating: 5, title: "Smooth trio", body: "Each bottle has a distinct character. The aged one is exceptional." },
    { author: "Dana S.", rating: 4, title: "Solid collection", body: "Good range. Pours are generous for a sampler." },
  ],
  "craft-beer-sampler": [
    { author: "Theo K.", rating: 5, title: "Great variety", body: "Twelve different cans, all fresh. Found two new favorites." },
    { author: "Mara V.", rating: 4, title: "Fun sampler", body: "Nice mix of styles. A couple were too hoppy for me but that's taste." },
  ],
```

Replace `priceCart` with the opts-aware version:

```ts
export function priceCart(items: CartItemInput[], opts: PriceOpts = {}): PricedCart {
  const byId = new Map(CATALOG.map((p) => [p.id, p]));
  const lines: PricedCartLine[] = [];
  const unknownIds: string[] = [];
  let hasAgeRestricted = false;
  for (const { productId, quantity } of items) {
    const product = byId.get(productId);
    if (!product) {
      unknownIds.push(productId);
      continue;
    }
    if (quantity <= 0) continue;
    if (product.ageRestricted) hasAgeRestricted = true;
    lines.push({
      id: product.id,
      name: product.name,
      unitPrice: product.price,
      currency: product.currency,
      quantity,
      lineTotal: product.price * quantity,
    });
  }
  const itemCount = lines.reduce((sum, l) => sum + l.quantity, 0);
  const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  const loyaltyApplied = !!opts.loyaltyApplied;
  const discount = loyaltyApplied
    ? Math.round(subtotal * (LOYALTY_DISCOUNT_PCT / 100) * 100) / 100
    : 0;
  const total = Math.round((subtotal - discount) * 100) / 100;
  const currency = lines[0]?.currency ?? "USD";
  return {
    lines,
    itemCount,
    subtotal,
    discount,
    total,
    currency,
    unknownIds,
    hasAgeRestricted,
    ageVerified: !!opts.ageVerified,
    loyaltyApplied,
  };
}
```

Replace the `Order` interface and `createOrder`:

```ts
export interface Order {
  id: string;
  lines: PricedCartLine[];
  itemCount: number;
  subtotal: number;
  discount: number;
  total: number;
  currency: string;
  createdAt: string;
}

export function createOrder(items: CartItemInput[], id: string, opts: PriceOpts = {}): Order {
  const { lines, itemCount, subtotal, discount, total, currency } = priceCart(items, opts);
  return { id, lines, itemCount, subtotal, discount, total, currency, createdAt: new Date().toISOString() };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm run test -- catalog`
Expected: PASS (all catalog tests, including the pre-existing ones — `total` still equals `price*qty` with no opts).

- [ ] **Step 5: Commit**

```bash
git add catalog.ts catalog.test.ts
git commit -m "feat(catalog): alcohol products, age-restricted flag, loyalty discount pricing"
```

---

## Task 2: Verification store

**Files:**
- Create: `verificationStore.ts`
- Test: `verificationStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `verificationStore.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { MemoryVerificationStore } from "./verificationStore.js";

describe("MemoryVerificationStore", () => {
  it("defaults to unverified", async () => {
    const s = new MemoryVerificationStore();
    const v = await s.read();
    expect(v.ageVerified).toBe(false);
    expect(v.loyalty.applied).toBe(false);
    expect(v.loyalty.membershipNumber).toBeNull();
  });

  it("merges partial writes", async () => {
    const s = new MemoryVerificationStore();
    await s.write({ ageVerified: true });
    expect((await s.read()).ageVerified).toBe(true);
    await s.write({ loyalty: { applied: true, membershipNumber: "LM-123" } });
    const v = await s.read();
    expect(v.ageVerified).toBe(true);
    expect(v.loyalty).toEqual({ applied: true, membershipNumber: "LM-123" });
  });

  it("clear resets to defaults", async () => {
    const s = new MemoryVerificationStore();
    await s.write({ ageVerified: true });
    await s.clear();
    expect((await s.read()).ageVerified).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npm run test -- verificationStore`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `verificationStore.ts`**

```ts
import { Redis } from "@upstash/redis";

// Demo-global age + loyalty verification state, mirroring cartStore.ts. Not
// per-conversation — like the cart, this is shared demo state. The credential
// gate writes it; the server reads it to gate checkout and price discounts.
export interface Verification {
  ageVerified: boolean;
  loyalty: { applied: boolean; membershipNumber: string | null };
}

function defaults(): Verification {
  return { ageVerified: false, loyalty: { applied: false, membershipNumber: null } };
}

export interface VerificationStore {
  read(): Promise<Verification>;
  write(patch: Partial<Verification>): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryVerificationStore implements VerificationStore {
  private state: Verification = defaults();
  async read(): Promise<Verification> {
    return { ageVerified: this.state.ageVerified, loyalty: { ...this.state.loyalty } };
  }
  async write(patch: Partial<Verification>): Promise<void> {
    this.state = { ...this.state, ...patch };
  }
  async clear(): Promise<void> {
    this.state = defaults();
  }
}

const VERIFICATION_KEY = "product-picker:verification";

export class RedisVerificationStore implements VerificationStore {
  private redis: Redis;
  constructor(url: string, token: string) {
    this.redis = new Redis({ url, token });
  }
  async read(): Promise<Verification> {
    return (await this.redis.get<Verification>(VERIFICATION_KEY)) ?? defaults();
  }
  async write(patch: Partial<Verification>): Promise<void> {
    const current = await this.read();
    await this.redis.set(VERIFICATION_KEY, { ...current, ...patch });
  }
  async clear(): Promise<void> {
    await this.redis.del(VERIFICATION_KEY);
  }
}

export function selectVerificationStore(env: NodeJS.ProcessEnv): VerificationStore {
  const url = env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return new RedisVerificationStore(url, token);
  return new MemoryVerificationStore();
}

export const verificationStore: VerificationStore = selectVerificationStore(process.env);
```

- [ ] **Step 4: Run test, verify pass**

Run: `npm run test -- verificationStore`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add verificationStore.ts verificationStore.test.ts
git commit -m "feat: demo-global verification store (age + loyalty)"
```

---

## Task 3: Credential DCQL builders

**Files:**
- Create: `payment-gate/credential-gate/dcql.ts`
- Test: `payment-gate/credential-gate/dcql.test.ts`

- [ ] **Step 1: Write the failing test**

Create `payment-gate/credential-gate/dcql.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildCredentialDcql } from "./dcql.js";

describe("buildCredentialDcql", () => {
  it("age query requests mDL age_over_21 / age_over_18", () => {
    const dcql = buildCredentialDcql("age");
    const ids = dcql.credentials.map((c) => c.id);
    expect(ids).toContain("mdl");
    const mdl = dcql.credentials.find((c) => c.id === "mdl")!;
    expect(mdl.meta.doctype_value).toBe("org.iso.18013.5.1.mDL");
    const paths = mdl.claims.map((c) => c.path.join("/"));
    expect(paths).toContain("org.iso.18013.5.1/age_over_21");
    expect(paths).toContain("org.iso.18013.5.1/age_over_18");
  });

  it("loyalty query requests the loyalty doctype", () => {
    const dcql = buildCredentialDcql("loyalty");
    const opt = dcql.credentials[0];
    expect(opt.meta.doctype_value).toBe("org.multipaz.loyalty.1");
    const paths = opt.claims.map((c) => c.path.join("/"));
    expect(paths).toContain("org.multipaz.loyalty.1/membership_number");
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npm run test -- credential-gate/dcql`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `payment-gate/credential-gate/dcql.ts`**

```ts
// DCQL builders for the non-payment credential gate, ported from a2ui_concierge
// (mcp/data.py + mcp/dcql.py). One query per kind, embedded in the signed
// OpenID4VP request. verify.ts maps disclosed claims back to a boolean.
export type CredentialKind = "age" | "loyalty";

export interface CredClaim {
  path: string[];
  intent_to_retain?: boolean;
}

export interface CredOption {
  id: string;
  format: "mso_mdoc";
  meta: Record<string, string>;
  claims: CredClaim[];
}

export interface CredentialDcql {
  credentials: CredOption[];
}

const AGE_OPTIONS: CredOption[] = [
  {
    id: "mdl",
    format: "mso_mdoc",
    meta: { doctype_value: "org.iso.18013.5.1.mDL" },
    claims: [
      { path: ["org.iso.18013.5.1", "age_over_21"], intent_to_retain: false },
      { path: ["org.iso.18013.5.1", "age_over_18"], intent_to_retain: false },
    ],
  },
  {
    id: "eupid",
    format: "mso_mdoc",
    meta: { doctype_value: "eu.europa.ec.eudi.pid.1" },
    claims: [{ path: ["eu.europa.ec.eudi.pid.1", "age_over_18"], intent_to_retain: false }],
  },
];

const LOYALTY_OPTIONS: CredOption[] = [
  {
    id: "loyalty",
    format: "mso_mdoc",
    meta: { doctype_value: "org.multipaz.loyalty.1" },
    claims: [
      { path: ["org.multipaz.loyalty.1", "membership_number"], intent_to_retain: false },
      { path: ["org.multipaz.loyalty.1", "tier"], intent_to_retain: false },
    ],
  },
];

export function buildCredentialDcql(kind: CredentialKind): CredentialDcql {
  return { credentials: kind === "age" ? AGE_OPTIONS : LOYALTY_OPTIONS };
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npm run test -- credential-gate/dcql`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add payment-gate/credential-gate/dcql.ts payment-gate/credential-gate/dcql.test.ts
git commit -m "feat(credential-gate): age + loyalty DCQL builders"
```

---

## Task 4: Credential claim evaluation (verify)

**Files:**
- Create: `payment-gate/credential-gate/verify.ts`
- Test: `payment-gate/credential-gate/verify.test.ts`

This reuses `decodeVpToken` (and its `DisclosedEntry` type) from `payment-gate/dc-payment/mdoc.ts`. The pure evaluator is unit-tested; the JWE-decrypt wrapper is exercised in the route integration test (Task 7/8).

- [ ] **Step 1: Write the failing test**

Create `payment-gate/credential-gate/verify.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { evaluateCredential } from "./verify.js";
import type { DisclosedEntry } from "../dc-payment/mdoc.js";

function disclosed(label: string, value: unknown): DisclosedEntry[] {
  return [{ id: "x", format: "mso_mdoc", claims: [{ label, value }] }];
}

describe("evaluateCredential — age", () => {
  it("passes when age_over_21 is true", () => {
    const r = evaluateCredential("age", disclosed("org.iso.18013.5.1 / age_over_21", true), true);
    expect(r.verified).toBe(true);
  });
  it("passes via wallet attestation when token present but no age claim extracted", () => {
    const r = evaluateCredential("age", [], true);
    expect(r.verified).toBe(true);
  });
  it("fails when nothing presented", () => {
    const r = evaluateCredential("age", [], false);
    expect(r.verified).toBe(false);
  });
  it("fails when age_over_21 explicitly false and no token", () => {
    const r = evaluateCredential("age", disclosed("org.iso.18013.5.1 / age_over_21", false), false);
    expect(r.verified).toBe(false);
  });
});

describe("evaluateCredential — loyalty", () => {
  it("passes and captures membership number", () => {
    const r = evaluateCredential(
      "loyalty",
      disclosed("org.multipaz.loyalty.1 / membership_number", "LM-9001"),
      true,
    );
    expect(r.verified).toBe(true);
    expect(r.membershipNumber).toBe("LM-9001");
  });
  it("passes via token presence even without claims", () => {
    const r = evaluateCredential("loyalty", [], true);
    expect(r.verified).toBe(true);
    expect(r.membershipNumber).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npm run test -- credential-gate/verify`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `payment-gate/credential-gate/verify.ts`**

```ts
// Map a wallet's disclosed mdoc claims to a verified boolean, ported from
// a2ui_concierge credential_verifier.py with the same tiered fallback:
//   1. real claim value (age_over_21/18 true, or age_in_years >= threshold)
//   2. wallet attestation (a token was returned for the DCQL we sent)
//   3. token presence (something came back at all)
// No cryptographic trust check — matches the dc-payment gate (future work).
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

export function evaluateCredential(
  kind: CredentialKind,
  disclosed: DisclosedEntry[],
  tokenPresent: boolean,
): CredGateResult {
  if (kind === "age") {
    const over21 = findClaim(disclosed, "age_over_21");
    const over18 = findClaim(disclosed, "age_over_18");
    const years = claimText(findClaim(disclosed, "age_in_years"));
    const byClaim = claimTruthy(over21) || claimTruthy(over18) || (years != null && Number(years) >= 18);
    if (byClaim) {
      return { verified: true, membershipNumber: null, gates: [{ gate: "Age over 21", pass: true, detail: "verified via mDL claim" }] };
    }
    if (tokenPresent) {
      return { verified: true, membershipNumber: null, gates: [{ gate: "Age over 21", pass: true, detail: "verified via wallet attestation" }] };
    }
    return { verified: false, membershipNumber: null, gates: [{ gate: "Age over 21", pass: false, detail: "no credential presented" }] };
  }

  // loyalty
  const membership = claimText(findClaim(disclosed, "membership_number"));
  const hasClaims = disclosed.some((e) => e.claims.length > 0);
  const verified = hasClaims || tokenPresent;
  return {
    verified,
    membershipNumber: membership,
    gates: [{ gate: "Loyalty membership", pass: verified, detail: membership ? `member ${membership}` : verified ? "presented" : "none" }],
  };
}

// Decrypt the wallet's JWE response, decode the vp_token, and evaluate. Mirrors
// dc-payment/verify.ts but without payment binding. Returns verified + gates.
export async function verifyCredentialPresentation(args: {
  kind: CredentialKind;
  result: { protocol?: string; data?: unknown };
  readerContextToken: string;
  secret: string;
}): Promise<CredGateResult> {
  const { kind, result, readerContextToken, secret } = args;
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
  return evaluateCredential(kind, disclosed, !!vpToken);
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npm run test -- credential-gate/verify`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add payment-gate/credential-gate/verify.ts payment-gate/credential-gate/verify.test.ts
git commit -m "feat(credential-gate): tiered claim evaluation + JWE verify"
```

---

## Task 5: Export shared crypto helpers + credential request builder

**Files:**
- Modify: `payment-gate/dc-payment/request.ts`
- Create: `payment-gate/credential-gate/request.ts`

No new unit test (crypto is integration-tested via the route in Task 7). Verify with typecheck.

- [ ] **Step 1: Export the reusable helpers from `payment-gate/dc-payment/request.ts`**

Change the `makeReaderCert` declaration from `async function` to an exported one, and add an exported encryption-key helper. Replace:

```ts
async function makeReaderCert(rpID: string): Promise<{ x5c: string; privateKey: NodeWebCrypto.CryptoKey }> {
```

with:

```ts
export async function makeReaderCert(rpID: string): Promise<{ x5c: string; privateKey: NodeWebCrypto.CryptoKey }> {
```

Then, immediately after `makeReaderCert`, add:

```ts
// Ephemeral P-256 key the wallet encrypts its response to. Shared by the payment
// and credential gates so both build the response-encryption JWK identically.
export async function makeEncryptionKey(): Promise<{ encJwk: jose.JWK; ecdhPrivateJwk: jose.JWK }> {
  const encKP = await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const encPubJwk = await webcrypto.subtle.exportKey("jwk", encKP.publicKey);
  const ecdhPrivateJwk = (await webcrypto.subtle.exportKey("jwk", encKP.privateKey)) as jose.JWK;
  const encJwk = { kty: "EC", crv: "P-256", x: encPubJwk.x, y: encPubJwk.y, use: "enc", alg: "ECDH-ES", kid: "response-encryption-key" } as jose.JWK;
  return { encJwk, ecdhPrivateJwk };
}
```

(Leave the existing inline ECDH code in `buildSignedRequest` as-is; this is an additive export. Optionally refactor `buildSignedRequest` to call `makeEncryptionKey` — not required.)

- [ ] **Step 2: Create `payment-gate/credential-gate/request.ts`**

```ts
// Signed OpenID4VP request for a credential (age / loyalty) gate. Like
// dc-payment/request.ts but with NO transaction_data — age/loyalty is not a
// payment, so there's no amount to bind. Reuses the reader cert + encryption key
// helpers from the payment gate, and seals an empty txData into the reader
// context (verify.ts ignores it for credential gates).
import * as jose from "jose";
import type { Origin } from "../origin.js";
import { makeReaderCert, makeEncryptionKey } from "../dc-payment/request.js";
import { sealReaderContext } from "../dc-payment/readerContext.js";
import { buildCredentialDcql, type CredentialKind } from "./dcql.js";

export interface SignedRequest {
  request: string;
  readerContextToken: string;
}

export async function buildCredentialRequest(
  kind: CredentialKind,
  origin: Origin,
  secret: string,
): Promise<SignedRequest> {
  const { x5c, privateKey } = await makeReaderCert(origin.rpID);
  const { encJwk, ecdhPrivateJwk } = await makeEncryptionKey();
  const nonce = jose.base64url.encode(crypto.getRandomValues(new Uint8Array(16)));

  const requestObject = {
    response_type: "vp_token",
    response_mode: "dc_api.jwt",
    client_id: `x509_san_dns:${origin.rpID}`,
    expected_origins: [origin.origin],
    nonce,
    dcql_query: buildCredentialDcql(kind),
    client_metadata: {
      vp_formats_supported: { mso_mdoc: { issuerauth_alg_values: [-7], deviceauth_alg_values: [-7] } },
      jwks: { keys: [encJwk] },
    },
  };

  const request = await new jose.SignJWT(requestObject)
    .setProtectedHeader({ alg: "ES256", typ: "oauth-authz-req+jwt", x5c: [x5c] })
    .setIssuedAt()
    .sign(privateKey as unknown as jose.KeyLike);

  const readerContextToken = await sealReaderContext({ ecdhPrivateJwk, transactionDataB64: "" }, secret);
  return { request, readerContextToken };
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no type errors).

- [ ] **Step 4: Commit**

```bash
git add payment-gate/dc-payment/request.ts payment-gate/credential-gate/request.ts
git commit -m "feat(credential-gate): signed OpenID4VP request (no payment binding)"
```

---

## Task 6: Gate page (real DC + instant-demo)

**Files:**
- Create: `payment-gate/credential-gate/page.ts`

No unit test (HTML string); verified via the route integration test in Task 7 and manual browser testing.

- [ ] **Step 1: Implement `payment-gate/credential-gate/page.ts`**

```ts
// Server-rendered credential gate page (age or loyalty). Runs
// navigator.credentials.get({digital}) with the server's signed request and
// POSTs the encrypted response to /verify. Falls back to an instant-demo button
// (POST /demo) when the Digital Credentials API is unavailable. Styled like the
// dc-payment gate.
export type CredentialKind = "age" | "loyalty";

interface PageArgs {
  kind: CredentialKind;
  order?: string; // optional order token, echoed back so the widget can resume
}

const COPY: Record<CredentialKind, { title: string; lede: string; cta: string; demo: string }> = {
  age: {
    title: "Verify your age (21+)",
    lede: "Your cart contains age-restricted items. Present a digital ID (mobile driver's license) so we can confirm you're 21 or older. Nothing is stored — only an over-21 check.",
    cta: "Verify with my digital ID",
    demo: "Verify age (instant demo)",
  },
  loyalty: {
    title: "Apply loyalty discount",
    lede: "Present your loyalty membership credential to take 10% off your whole cart. Optional — your purchase works without it.",
    cta: "Present loyalty credential",
    demo: "Apply loyalty (instant demo)",
  },
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderCredentialPage(args: PageArgs): string {
  const { kind } = args;
  const order = args.order ? escapeHtml(args.order) : "";
  const c = COPY[kind];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(c.title)}</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 560px; margin: 3rem auto; padding: 0 1.25rem; color: #1a1a1a; }
  h1 { font-size: 1.35rem; margin-bottom: 0.25rem; }
  p.lede { color: #555; margin-top: 0; line-height: 1.45; }
  button { font-size: 1rem; padding: 0.75rem 1.1rem; border-radius: 6px; border: 1px solid #1a7f37; background: #1a7f37; color: #fff; cursor: pointer; width: 100%; margin-top: 0.75rem; }
  button.secondary { background: #fff; color: #1a7f37; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .step { padding: 0.4rem 0; font-family: ui-monospace, Menlo, monospace; font-size: 0.85rem; }
  .step.ok { color: #0a7f2e; } .step.err { color: #b00020; white-space: pre-wrap; }
  .notice { margin-top: 1rem; padding: 0.9rem 1rem; background: #fff7ed; border-left: 4px solid #d97706; border-radius: 6px; font-size: 0.9rem; }
  #done { display:none; margin-top:1.25rem; background:#0a7f2e; color:#fff; font-size:1.1rem; font-weight:700; padding:1rem 1.1rem; border-radius:8px; text-align:center; }
</style>
</head>
<body>
  <h1>${escapeHtml(c.title)}</h1>
  <p class="lede">${escapeHtml(c.lede)}</p>
  <button id="go">${escapeHtml(c.cta)}</button>
  <button id="demo" class="secondary">${escapeHtml(c.demo)}</button>
  <div id="log"></div>
  <div id="done">✓ Done — you can close this page and return to the chat.</div>
  <script type="module">
    const KIND = ${JSON.stringify(kind)};
    const ORDER = ${JSON.stringify(order)};
    const base = "/credential-gate/" + KIND;
    const log = document.getElementById("log");
    const go = document.getElementById("go");
    const demo = document.getElementById("demo");
    const doneEl = document.getElementById("done");
    const step = (t, c = "") => { const d = document.createElement("div"); d.className = "step " + c; d.textContent = t; log.appendChild(d); };
    function notice(html) { const d = document.createElement("div"); d.className = "notice"; d.innerHTML = html; log.appendChild(d); }
    function done() { go.disabled = true; demo.disabled = true; doneEl.style.display = "block"; }

    go.addEventListener("click", async () => {
      go.disabled = true;
      if (!("credentials" in navigator) || !window.DigitalCredential) {
        notice("This browser doesn't support <code>navigator.credentials.get({digital})</code> (need <strong>Chrome 141+</strong>). Use the instant-demo button below.");
        go.disabled = false;
        return;
      }
      try {
        step("→ GET signed request");
        const { request, readerContextToken } = await fetch(base + "/request").then((r) => r.json());
        step("→ navigator.credentials.get({digital}) — Chrome should show a QR…");
        const result = await navigator.credentials.get({ digital: { requests: [{ protocol: "openid4vp-v1-signed", data: { request } }] }, mediation: "required" });
        let data = result?.data ?? null;
        if (typeof data === "string") { try { data = JSON.parse(data); } catch {} }
        step("→ verify");
        const out = await fetch(base + "/verify", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ readerContextToken, result: { protocol: result?.protocol ?? null, data } }),
        }).then((r) => r.json());
        if (!out.verified) throw new Error(out.error || "not verified");
        step("✓ verified", "ok");
        done();
      } catch (err) {
        step("✗ " + (err?.message ?? String(err)), "err");
        go.disabled = false;
      }
    });

    demo.addEventListener("click", async () => {
      demo.disabled = true;
      try {
        const out = await fetch(base + "/demo", { method: "POST" }).then((r) => r.json());
        if (!out.verified) throw new Error("demo failed");
        step("✓ verified (instant demo)", "ok");
        done();
      } catch (err) {
        step("✗ " + (err?.message ?? String(err)), "err");
        demo.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add payment-gate/credential-gate/page.ts
git commit -m "feat(credential-gate): age/loyalty gate page with instant-demo fallback"
```

---

## Task 7: Gate routes

**Files:**
- Create: `payment-gate/credential-gate/routes.ts`

- [ ] **Step 1: Implement `payment-gate/credential-gate/routes.ts`**

```ts
import express, { type Express, type Request, type Response } from "express";
import { deriveOrigin } from "../origin.js";
import { gateSecret } from "../challengeToken.js";
import { verificationStore } from "../../verificationStore.js";
import { buildCredentialRequest } from "./request.js";
import { verifyCredentialPresentation } from "./verify.js";
import { renderCredentialPage } from "./page.js";
import type { CredentialKind } from "./dcql.js";

function originOf(req: Request) {
  return deriveOrigin({ headers: req.headers, host: req.get("host") ?? "localhost", protocol: req.protocol });
}

function parseKind(raw: string): CredentialKind | null {
  return raw === "age" || raw === "loyalty" ? raw : null;
}

// Persist a successful verification into the demo-global store.
async function recordVerified(kind: CredentialKind, membershipNumber: string | null): Promise<void> {
  if (kind === "age") {
    await verificationStore.write({ ageVerified: true });
  } else {
    await verificationStore.write({ loyalty: { applied: true, membershipNumber } });
  }
}

export function registerCredentialGate(app: Express): void {
  app.get("/credential-gate/:kind", (req: Request, res: Response) => {
    const kind = parseKind(req.params.kind);
    if (!kind) { res.status(404).type("html").send("<!doctype html><h1>Unknown gate</h1>"); return; }
    const order = typeof req.query.order === "string" ? req.query.order : undefined;
    res.status(200).type("html").send(renderCredentialPage({ kind, order }));
  });

  app.get("/credential-gate/:kind/request", async (req: Request, res: Response) => {
    const kind = parseKind(req.params.kind);
    if (!kind) { res.status(404).json({ error: "unknown gate" }); return; }
    try {
      const out = await buildCredentialRequest(kind, originOf(req), gateSecret());
      res.json(out);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/credential-gate/:kind/verify", express.json({ limit: "4mb" }), async (req: Request, res: Response) => {
    const kind = parseKind(req.params.kind);
    if (!kind) { res.status(404).json({ error: "unknown gate" }); return; }
    const { readerContextToken, result } = req.body ?? {};
    try {
      const out = await verifyCredentialPresentation({ kind, result, readerContextToken, secret: gateSecret() });
      if (out.verified) await recordVerified(kind, out.membershipNumber);
      res.json(out);
    } catch (err) {
      res.status(400).json({ verified: false, error: (err as Error).message });
    }
  });

  // Instant-demo path: no real credential exchange, just mark verified. Mirrors
  // the payment gate's "Place order (instant demo)".
  app.post("/credential-gate/:kind/demo", async (req: Request, res: Response) => {
    const kind = parseKind(req.params.kind);
    if (!kind) { res.status(404).json({ error: "unknown gate" }); return; }
    await recordVerified(kind, kind === "loyalty" ? "DEMO-LOYALTY" : null);
    res.json({ verified: true, gates: [{ gate: kind === "age" ? "Age over 21" : "Loyalty membership", pass: true, detail: "instant demo" }] });
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add payment-gate/credential-gate/routes.ts
git commit -m "feat(credential-gate): page/request/verify/demo routes"
```

---

## Task 8: Wire gate + verification-status endpoint into the app

**Files:**
- Modify: `app.ts`
- Test: `app.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `app.test.ts`:

```ts
import { verificationStore } from "./verificationStore.js";

describe("credential gate wiring", () => {
  it("serves the age gate page", async () => {
    const app = createApp({ publicBaseUrl: "http://localhost:3001" });
    const res = await request(app).get("/credential-gate/age");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Verify your age");
  });

  it("404s an unknown gate kind", async () => {
    const app = createApp({ publicBaseUrl: "http://localhost:3001" });
    const res = await request(app).get("/credential-gate/bogus");
    expect(res.status).toBe(404);
  });

  it("instant-demo age verify flips verification-status", async () => {
    const app = createApp({ publicBaseUrl: "http://localhost:3001" });
    await verificationStore.clear();
    const before = await request(app).get("/checkout/verification-status");
    expect(before.body.ageVerified).toBe(false);
    const demo = await request(app).post("/credential-gate/age/demo");
    expect(demo.body.verified).toBe(true);
    const after = await request(app).get("/checkout/verification-status");
    expect(after.body.ageVerified).toBe(true);
  });

  it("instant-demo loyalty sets loyalty applied", async () => {
    const app = createApp({ publicBaseUrl: "http://localhost:3001" });
    await verificationStore.clear();
    await request(app).post("/credential-gate/loyalty/demo");
    const after = await request(app).get("/checkout/verification-status");
    expect(after.body.loyalty.applied).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm run test -- app`
Expected: FAIL (routes not mounted).

- [ ] **Step 3: Modify `app.ts`**

Add imports near the other gate imports:

```ts
import { registerCredentialGate } from "./payment-gate/credential-gate/routes.js";
import { verificationStore } from "./verificationStore.js";
```

Add the status endpoint near the `/checkout/order-status` route:

```ts
  // Read-only verification status for the embedded widget to poll after opening
  // an age/loyalty gate page. The browser polls; the agent never drives this.
  app.get("/checkout/verification-status", async (_req: Request, res: Response) => {
    const v = await verificationStore.read();
    res.json(v);
  });
```

Register the gate alongside the others (near `registerPasskeyGate(app)`):

```ts
  registerCredentialGate(app);
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm run test -- app`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app.ts app.test.ts
git commit -m "feat(app): mount credential gate + verification-status endpoint"
```

---

## Task 9: Server — price with verification, new tools, checkout guard

**Files:**
- Modify: `server.ts`
- Test: `app.test.ts` (supertest against the MCP tools is heavy; instead test the HTTP-observable behavior already covered, and rely on typecheck + manual Inspector for tools). Add one supertest for the checkout age-guard via the existing `/mcp`-free path is not feasible, so this task is verified by typecheck + the standalone/E2E steps.

- [ ] **Step 1: Modify the price helpers in `server.ts`**

Add the import:

```ts
import { verificationStore } from "./verificationStore.js";
```

Replace `priceFrom`, `readPriced`, `setQuantity`, `addToCart`, `removeFromCart` so they fold in verification state:

```ts
async function priceFrom(cart: Map<string, number>): Promise<PricedCart> {
  const items = [...cart.entries()].map(([productId, quantity]) => ({ productId, quantity }));
  const v = await verificationStore.read();
  return priceCart(items, { ageVerified: v.ageVerified, loyaltyApplied: v.loyalty.applied });
}

async function readPriced(): Promise<PricedCart> {
  return priceFrom(await cartStore.read());
}

async function setQuantity(productId: string, quantity: number): Promise<PricedCart> {
  const cart = await cartStore.read();
  if (quantity <= 0) cart.delete(productId);
  else cart.set(productId, quantity);
  await cartStore.write(cart);
  return priceFrom(cart);
}

async function addToCart(items: { productId: string; quantity: number }[]): Promise<PricedCart> {
  const cart = await cartStore.read();
  for (const { productId, quantity } of items) {
    if (quantity <= 0) continue;
    cart.set(productId, (cart.get(productId) ?? 0) + quantity);
  }
  await cartStore.write(cart);
  return priceFrom(cart);
}

async function removeFromCart(productId: string): Promise<PricedCart> {
  const cart = await cartStore.read();
  cart.delete(productId);
  await cartStore.write(cart);
  return priceFrom(cart);
}
```

> Note: `priceFrom` is now `async` and returns `Promise<PricedCart>`. The callers above already `await` it. The `browse-products` handler calls `await readPriced()` (unchanged).

- [ ] **Step 2: Add the verification tools** (inside `createServer`, after the `get-cart` tool registration)

```ts
  // Age verification: return the gate link for the user to open. Restricted
  // carts can't check out until this passes. UI-linked so the widget stays in
  // sync. (The widget also has its own button; this lets the agent drive it on
  // no-GUI hosts like Claude Code.)
  server.registerTool(
    "verify-age",
    {
      title: "Verify Age",
      description:
        "Return a link the user opens to verify they are 21+ with a digital ID. Required before checking out " +
        "a cart that contains age-restricted items (alcohol). The user completes verification on that page; " +
        "poll get-verification-status (or get-cart) to learn when it's done.",
      inputSchema: {},
      annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
    },
    async (): Promise<CallToolResult> => {
      const url = `${getCheckoutBaseUrl()}/credential-gate/age`;
      return {
        structuredContent: { url },
        content: [{ type: "text", text: JSON.stringify({ url }) }],
      };
    },
  );

  // Loyalty discount: return the gate link. Optional — applies 10% off the whole
  // cart once a valid loyalty credential is presented.
  server.registerTool(
    "apply-loyalty",
    {
      title: "Apply Loyalty Discount",
      description:
        "Return a link the user opens to present a loyalty membership credential for 10% off the whole cart. " +
        "Optional. The user completes it on that page; poll get-verification-status (or get-cart) for the result.",
      inputSchema: {},
      annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
    },
    async (): Promise<CallToolResult> => {
      const url = `${getCheckoutBaseUrl()}/credential-gate/loyalty`;
      return {
        structuredContent: { url },
        content: [{ type: "text", text: JSON.stringify({ url }) }],
      };
    },
  );

  // Report current verification state so the agent knows whether checkout is
  // unblocked and whether the loyalty discount is active.
  server.registerTool(
    "get-verification-status",
    {
      title: "Get Verification Status",
      description:
        "Read-only check of age verification and loyalty discount state. Use after sharing a verify-age or " +
        "apply-loyalty link to learn whether the user completed it.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (): Promise<CallToolResult> => {
      const v = await verificationStore.read();
      return {
        structuredContent: v as unknown as Record<string, unknown>,
        content: [{ type: "text", text: JSON.stringify(v) }],
      };
    },
  );
```

- [ ] **Step 3: Add the age guard inside the `checkout` tool handler**

In the `checkout` handler, after `entries` is resolved and the empty-cart check, before `createCheckoutOrder`, insert:

```ts
      const v = await verificationStore.read();
      const priced = priceCart(entries, { ageVerified: v.ageVerified, loyaltyApplied: v.loyalty.applied });
      if (priced.hasAgeRestricted && !v.ageVerified) {
        return {
          content: [
            { type: "text", text: "This cart contains age-restricted items. Call verify-age and have the user verify they're 21+ before checking out." },
          ],
          isError: true,
        };
      }
```

Then change `createCheckoutOrder(entries)` to carry the discount/age opts. Update the `createCheckoutOrder` call:

```ts
      const { orderId, checkoutUrl } = createCheckoutOrder(entries, {
        ageVerified: v.ageVerified,
        loyaltyApplied: v.loyalty.applied,
      });
```

- [ ] **Step 4: Update `createCheckoutOrder` in `checkout.ts`** to accept opts

In `checkout.ts`, change the signature and body:

```ts
import { createOrder, type CartItemInput, type Order, type PriceOpts } from "./catalog.js";
```

```ts
export function createCheckoutOrder(
  items: CartItemInput[],
  opts: PriceOpts = {},
): { orderId: string; checkoutUrl: string } {
  const order = createOrder(items, nextOrderId(), opts);
  const token = encodeOrder(order);
  return { orderId: order.id, checkoutUrl: `${checkoutBaseUrl}/checkout?order=${token}` };
}
```

- [ ] **Step 5: Update `browse-products` description text**

In the `browse-products` handler's returned text, append after the "You CANNOT" line:

```ts
            `Age-restricted items (alcohol, 21+) require age verification before checkout — call verify-age to get a link; ` +
            `checkout is blocked until the user verifies. Loyalty discount (10% off the cart) is optional — call apply-loyalty for a link.\n` +
```

- [ ] **Step 6: Typecheck + run full test suite**

Run: `npm run typecheck && npm run test`
Expected: PASS (existing tests still green; `priceFrom` async change compiles).

- [ ] **Step 7: Commit**

```bash
git add server.ts checkout.ts
git commit -m "feat(server): verification-aware pricing, age guard, loyalty tools"
```

---

## Task 10: Widget — badges, disabled checkout, gate buttons, discount line

**Files:**
- Modify: `src/app.tsx`, `src/app.module.css`

No unit test (UI); verified via `npm run dev` standalone and E2E. Build must pass.

- [ ] **Step 1: Add CSS** to `src/app.module.css` (append):

```css
.ageBadge {
  display: inline-block;
  font-size: 0.7rem;
  font-weight: 700;
  color: #b00020;
  border: 1px solid #b00020;
  border-radius: 4px;
  padding: 0 0.3rem;
  margin-left: 0.4rem;
  vertical-align: middle;
}
.discountRow { color: #0a7f2e; font-size: 0.85rem; }
.gateBtn {
  font-size: 0.9rem;
  padding: 0.5rem 0.8rem;
  border-radius: 6px;
  border: 1px solid #b00020;
  background: #fff;
  color: #b00020;
  cursor: pointer;
}
.loyaltyBtn {
  font-size: 0.9rem;
  padding: 0.5rem 0.8rem;
  border-radius: 6px;
  border: 1px solid #1a7f37;
  background: #fff;
  color: #1a7f37;
  cursor: pointer;
}
```

- [ ] **Step 2: Add a generic gate-opener + poller to `src/app.tsx`**

Add this helper near `pollOrderCompletion` (top-level function):

```ts
// Poll the verification-status endpoint until the user finishes a gate page.
async function pollVerification(
  origin: string,
  want: "age" | "loyalty",
  signal: { cancelled: boolean },
  opts: { intervalMs?: number; maxMs?: number } = {},
): Promise<boolean> {
  const intervalMs = opts.intervalMs ?? 2500;
  const deadline = Date.now() + (opts.maxMs ?? 5 * 60_000);
  while (!signal.cancelled && Date.now() < deadline) {
    try {
      const res = await fetch(`${origin}/checkout/verification-status`);
      if (res.ok) {
        const v = (await res.json()) as { ageVerified?: boolean; loyalty?: { applied?: boolean } };
        if (want === "age" && v.ageVerified) return true;
        if (want === "loyalty" && v.loyalty?.applied) return true;
      }
    } catch { /* keep polling */ }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}
```

- [ ] **Step 3: Add gate handlers in `HostApp`** (after the `checkout` useCallback)

```ts
  const baseOrigin = useCallback(() => {
    return new URL(getCheckoutBaseUrl()).origin;
  }, []);
```

That import won't exist client-side; instead derive the origin from a gate URL we fetch from the tool. Use the tool that returns the link. Add:

```ts
  const openGate = useCallback(async (kind: "age" | "loyalty") => {
    if (!appRef.current) return;
    const toolName = kind === "age" ? "verify-age" : "apply-loyalty";
    const result = await appRef.current.callServerTool({ name: toolName, arguments: {} });
    const parsed = parseJsonContent<{ url?: string }>(result);
    if (!parsed?.url) return;
    await appRef.current.openLink({ url: parsed.url });
    const origin = new URL(parsed.url).origin;
    const signal = { cancelled: false };
    const ok = await pollVerification(origin, kind, signal);
    if (!ok) return;
    const refreshed = await appRef.current?.callServerTool({ name: "get-cart", arguments: {} });
    const c = refreshed && parseJsonContent<PricedCart>(refreshed);
    if (c) applyCart(c);
  }, [applyCart]);
```

Pass `openGate` into `<Picker ... onVerifyAge={() => openGate("age")} onApplyLoyalty={() => openGate("loyalty")} />`.

- [ ] **Step 4: Add the same handlers to `ChatGptApp`**

```ts
  const openGate = useCallback(async (kind: "age" | "loyalty") => {
    const toolName = kind === "age" ? "verify-age" : "apply-loyalty";
    const result = await oai.callTool?.(toolName, {});
    const parsed = structuredOf(result) as { url?: string } | undefined;
    if (!parsed?.url) return;
    await oai.openExternal?.({ href: parsed.url });
    const origin = new URL(parsed.url).origin;
    const ok = await pollVerification(origin, kind, { cancelled: false });
    if (!ok) return;
    const refreshed = await oai.callTool?.("get-cart", {});
    applyToolOutput(structuredOf(refreshed));
  }, [oai, applyToolOutput]);
```

Pass into `<Picker ... onVerifyAge={() => openGate("age")} onApplyLoyalty={() => openGate("loyalty")} />`.

- [ ] **Step 5: Standalone mocks in `StandaloneApp`**

```ts
  const [ageVerified, setAgeVerified] = useState(false);
  const [loyaltyApplied, setLoyaltyApplied] = useState(false);

  // Re-price locally whenever flags change so the discount line + gating show.
  useEffect(() => {
    const all = [...qtys.current.entries()].map(([productId, quantity]) => ({ productId, quantity }));
    setCart(priceCartLocal(all, { ageVerified, loyaltyApplied }));
  }, [ageVerified, loyaltyApplied]);
```

Update the standalone `setQuantity` to pass the flags:

```ts
    setCart(priceCartLocal(all, { ageVerified, loyaltyApplied }));
```

Render:

```tsx
  return (
    <Picker
      products={CATALOG}
      cart={cart}
      setQuantity={setQuantity}
      onVerifyAge={async () => setAgeVerified(true)}
      onApplyLoyalty={async () => setLoyaltyApplied(true)}
    />
  );
```

- [ ] **Step 6: Extend `PickerProps` and the `Picker` UI**

Update the interface:

```ts
interface PickerProps {
  products: Product[];
  cart: PricedCart;
  insets?: Insets;
  setQuantity: SetQuantityFn;
  checkout?: CheckoutFn;
  confirmedOrder?: CompletedOrder | null;
  onVerifyAge?: () => Promise<void>;
  onApplyLoyalty?: () => Promise<void>;
}
```

Destructure them in `Picker({ ... onVerifyAge, onApplyLoyalty })`.

In the product card, after the `<span className={styles.name}>{p.name}</span>`, add the badge:

```tsx
                  <span className={styles.name}>
                    {p.name}
                    {p.ageRestricted && <span className={styles.ageBadge}>21+</span>}
                  </span>
```

Replace the footer block with one that shows the discount line, the loyalty button, and gates checkout on age:

```tsx
      <div className={styles.footer}>
        <span className={styles.summary}>
          {cart.itemCount > 0
            ? `🛒 ${cart.itemCount} in cart · ${formatMoney(cart.total, cart.currency)}`
            : "🛒 Cart is empty"}
          {cart.discount > 0 && (
            <span className={styles.discountRow}> · −{formatMoney(cart.discount, cart.currency)} loyalty</span>
          )}
        </span>
        {onApplyLoyalty && cart.itemCount > 0 && !cart.loyaltyApplied && (
          <button className={styles.loyaltyBtn} onClick={() => onApplyLoyalty()}>
            Apply loyalty discount
          </button>
        )}
        {onVerifyAge && cart.hasAgeRestricted && !cart.ageVerified && (
          <button className={styles.gateBtn} onClick={() => onVerifyAge()}>
            Verify age (21+)
          </button>
        )}
        {checkout && cart.itemCount > 0 && (
          <button
            className={styles.checkout}
            disabled={checkingOut || (cart.hasAgeRestricted && !cart.ageVerified)}
            onClick={handleCheckout}
          >
            {checkingOut ? "Opening…" : cart.hasAgeRestricted && !cart.ageVerified ? "Verify age to check out" : "Checkout"}
          </button>
        )}
      </div>
```

- [ ] **Step 7: Update `emptyCart()` helper** in `src/app.tsx` to the new shape:

```ts
function emptyCart(): PricedCart {
  return {
    lines: [], itemCount: 0, subtotal: 0, discount: 0, total: 0, currency: "USD",
    unknownIds: [], hasAgeRestricted: false, ageVerified: false, loyaltyApplied: false,
  };
}
```

- [ ] **Step 8: Build the UI**

Run: `npm run build:ui`
Expected: PASS (Vite bundles to `dist/mcp-app.html` with no type/JSX errors).

- [ ] **Step 9: Manual standalone check**

Run: `npm run dev`, open `http://localhost:5173/mcp-app.html?standalone`. Add an alcohol item → Checkout shows "Verify age to check out" and is disabled, `21+` badge visible, "Verify age (21+)" button present. Click it → Checkout enables. Click "Apply loyalty discount" → discount line appears and total drops 10%.

- [ ] **Step 10: Commit**

```bash
git add src/app.tsx src/app.module.css
git commit -m "feat(widget): 21+ badge, age-gated checkout, loyalty discount UI"
```

---

## Task 11: Discount on checkout page + confirmation

**Files:**
- Modify: `checkout.ts`, `src/app.tsx`
- Test: `checkout.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `checkout.test.ts`:

```ts
import { renderCheckoutPageForTest } from "./checkout.js"; // see step 3 note

describe("checkout page discount", () => {
  it("shows the loyalty discount line when the order has a discount", () => {
    const order = createOrder([{ productId: CATALOG[0].id, quantity: 2 }], "ORD-DISC02", { loyaltyApplied: true });
    const { status, html } = checkoutResponse(encodeOrder(order));
    expect(status).toBe(200);
    expect(html).toContain("Loyalty");
    expect(html).toMatch(/-\s*\$/); // a negative discount amount is rendered
  });
});
```

> Note: `checkoutResponse` is already exported and takes a token. No new export needed — delete the unused `renderCheckoutPageForTest` import line; use `checkoutResponse(encodeOrder(order))` as shown.

- [ ] **Step 2: Run test, verify it fails**

Run: `npm run test -- checkout`
Expected: FAIL (no discount line rendered).

- [ ] **Step 3: Add the discount row in `renderCheckoutPage` (`checkout.ts`)**

In `renderCheckoutPage`, replace the total row block:

```ts
    <tr class="total"><td>Total</td><td class="num">${formatMoney(order.total, order.currency)}</td></tr>
```

with:

```ts
    ${order.discount > 0 ? `<tr><td>Loyalty discount</td><td class="num">-${formatMoney(order.discount, order.currency)}</td></tr>` : ""}
    <tr class="total"><td>Total</td><td class="num">${formatMoney(order.total, order.currency)}</td></tr>
```

- [ ] **Step 4: Run test, verify pass**

Run: `npm run test -- checkout`
Expected: PASS.

- [ ] **Step 5: Show discount in the widget confirmation panel** (`src/app.tsx`)

The `CompletedOrder` type used by the widget comes from `orderStore.CompletedOrder` (amount/currency only). The confirmation already shows Total = `amount`. No change required for correctness, but add a small note when loyalty was applied is out of scope (the order amount is already discounted). Skip — leave confirmation as-is.

- [ ] **Step 6: Commit**

```bash
git add checkout.ts checkout.test.ts
git commit -m "feat(checkout): show loyalty discount on the checkout page"
```

---

## Task 12: Full verification + README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run the whole suite + build**

Run: `npm run build && npm run test`
Expected: typecheck PASS, UI bundle written, all tests PASS.

- [ ] **Step 2: Add a short README section** after the existing feature description:

```markdown
### Age verification & loyalty discount

Some products are age-restricted (alcohol, 21+). When the cart contains one, the
widget disables **Checkout** and shows **Verify age (21+)**, which opens a gate
page that requests a digital ID (`age_over_21`) via OpenID4VP — with an
instant-demo fallback button when no wallet/Chrome 141+ is available. A separate
**Apply loyalty discount** button presents a loyalty credential for 10% off the
whole cart. State is demo-global (like the cart). In chat-only hosts the agent
drives this with the `verify-age`, `apply-loyalty`, and `get-verification-status`
tools.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: age verification + loyalty discount"
```

---

## Self-Review notes

- **Spec coverage:** alcohol products (T1), `ageRestricted`/discount/`PricedCart` (T1), `verificationStore` (T2), DCQL (T3), tiered verifier (T4), signed request reuse (T5), gate page + instant-demo (T6), routes + store writes (T7), `verification-status` + mount (T8), price-with-verification + tools + age guard + browse text (T9), widget badges/disabled checkout/buttons/discount/poll/standalone mocks (T10), checkout-page discount (T11), README + final build (T12). All spec sections mapped.
- **Type consistency:** `PriceOpts` (`ageVerified`, `loyaltyApplied`) used identically in `priceCart`, `createOrder`, `createCheckoutOrder`. `Verification` shape (`ageVerified`, `loyalty.{applied,membershipNumber}`) consistent across store, routes, status endpoint, widget poll. `CredentialKind` (`"age" | "loyalty"`) consistent across dcql/verify/request/page/routes. `CredGateResult.verified` consistent. `priceFrom` made async — callers already await.
- **E2E in Claude Desktop:** after T12, `npm run build && PORT=3001 node dist/main.js`, expose via tunnel (HTTPS), add as a custom connector; the instant-demo buttons make the full flow work without a wallet.
