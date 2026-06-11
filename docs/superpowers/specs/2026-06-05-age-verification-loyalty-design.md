# Age Verification + Loyalty Discount — Design

**Date:** 2026-06-05
**Status:** Approved (pending spec review)

## Goal

Enhance the Product Picker MCP app checkout so that:

1. The catalog includes **age-restricted products** (alcohol).
2. When the cart contains an age-restricted item, the widget's **Checkout
   button is disabled** and a **"Verify age (21+)" button** appears. The user
   presents a digital credential proving `age_over_21`; on success Checkout
   enables.
3. A **loyalty discount is optional**: presenting a valid loyalty digital
   credential applies **10% off the whole cart**.

It stays **one MCP server + one widget bundle** on every surface (Claude
native, claude.ai, Claude Desktop, ChatGPT, Goose, Claude Code). No new
architecture: we reuse the existing **widget → open browser gate page → poll
status endpoint** loop already used for payment, and the **OpenID4VP
digital-credential stack** in `payment-gate/dc-payment/`.

This mirrors how the sibling project `a2ui_concierge` handles the same problem:
products carry `required_credentials: ["age_verification"]`, DCQL queries
request mDL `age_over_21`/`age_over_18` claims, and a tiered CBOR verifier maps
the VP token's `elementValue` back to a boolean. Loyalty is an optional
credential granting a `loyalty_discount_pct`.

## Decisions (locked)

- **Credential mechanism:** real OpenID4VP digital credential
  (`navigator.credentials.get({digital})`) on a gate page, **with an
  instant-demo fallback button** — matching the existing payment gate. The real
  path needs Chrome 141+ and a wallet holding an mDL; everyone else uses the
  demo button.
- **Loyalty discount:** **10% off the whole cart** when a valid loyalty
  credential is presented (`LOYALTY_DISCOUNT_PCT = 10`).
- **Enforcement:** the **widget gate is the demo's gate** (Checkout disabled
  until verified). A light tool-level guard also refuses age-restricted
  carts in the `checkout` tool. No hand-edit-proof server enforcement of the
  checkout link.

## Architecture

### Data flow

```
widget (alcohol in cart, not verified)
  → Checkout disabled, "Verify age (21+)" shown
  → user clicks → openLink(/credential-gate/age?order=<token>)
       gate page: navigator.credentials.get({digital})  (or instant-demo button)
       → POST /credential-gate/age/verify → verificationStore.write({ageVerified:true})
  → widget polls /checkout/verification-status → ageVerified:true
  → widget refreshes cart (get-cart) → Checkout enables

loyalty (any time)
  → "Apply loyalty discount" → openLink(/credential-gate/loyalty?...)
       → POST /credential-gate/loyalty/verify → verificationStore.write({loyalty})
  → poll → refresh cart → PricedCart now shows −10% discount line + new total
```

Age/loyalty/discount state is **folded into the `PricedCart` payload** that
every cart tool already returns, so the widget reflects it without a separate
fetch. Verification state is **demo-global**, exactly like the cart.

### Components

**1. `catalog.ts`**
- `Product` gains `ageRestricted?: boolean`.
- Add 3 alcohol items in a new `Beverages` category with `ageRestricted: true`
  (Champagne Gift Set, Whiskey Collection, Craft Beer Sampler), plus sample
  `REVIEWS` entries so the agent can answer questions about them.
- Add `export const LOYALTY_DISCOUNT_PCT = 10`.
- `PricedCart` gains: `subtotal`, `discount`, `total` (= `subtotal - discount`),
  and derived flags `hasAgeRestricted`, `ageVerified`, `loyaltyApplied`.
- `priceCart(items, opts?: { ageVerified?; loyaltyApplied? })` computes the
  whole-cart discount when `loyaltyApplied` and sets the flags. `hasAgeRestricted`
  is derived from the catalog regardless of opts.
- `Order` (snapshot) gains `subtotal` and `discount`; `total` is the discounted
  amount. `createOrder` accepts the same opts so the snapshot matches the cart.

**2. `verificationStore.ts`** (new — mirrors `cartStore.ts`)
- Shape: `{ ageVerified: boolean; loyalty: { applied: boolean; membershipNumber?: string | null } }`.
- `MemoryVerificationStore` + `RedisVerificationStore` + `selectVerificationStore(env)`
  using the same `KV_REST_API_*` / `UPSTASH_*` env detection. Key
  `product-picker:verification`. Exposes `read()`, `write(partial)`, `clear()`.

**3. `payment-gate/credential-gate/`** (new — reuses dc-payment crypto)
- `dcql.ts` — `CredentialDefinition`/`CredentialOption` + `buildCredentialDcql(key)`
  for `age_verification` (mDL `age_over_21`/`age_over_18`, EU PID `age_over_18`)
  and `loyalty_membership` (`org.multipaz.loyalty.1`: `membership_number`,
  `tier`). Ported from a2ui `mcp/dcql.py` + `mcp/data.py`.
- `request.ts` — builds a signed OpenID4VP request for a given DCQL. Reuses the
  reader-cert + ephemeral-ECDH helpers from `dc-payment/request.ts` **minus the
  payment `transaction_data`** (age/loyalty is not a payment, no amount binding).
  To avoid destabilizing the working payment gate, factor the shared cert/ECDH
  helper into a small exported function (or a new `crypto.ts`) and have both
  request builders call it.
- `verify.ts` — decrypts the JWE response (reuse `openReaderContext` +
  `compactDecrypt`), extracts CBOR claims via `mdoc.ts` `decodeVpToken`, and
  evaluates the credential with a2ui's **tiered fallback**: (1) real claim value
  (`age_over_21`/`age_over_18` true, or `age_in_years >= 18`/`21`), (2) wallet
  attestation (token returned for the DCQL), (3) token presence. Loyalty:
  presented option / extracted claims / token presence. Ported from a2ui
  `credential_verifier.py`.
- `page.ts` — renders the age and loyalty gate pages (variant by `kind`), each
  with the real `navigator.credentials.get({digital})` call **and an
  instant-demo button**, styled like `dc-payment/page.ts`.
- `routes.ts` — `registerCredentialGate(app)` registers, for each kind:
  - `GET /credential-gate/:kind` → render page (kind ∈ `age` | `loyalty`).
  - `GET /credential-gate/:kind/request` → signed request JSON.
  - `POST /credential-gate/:kind/verify` → verify, then
    `verificationStore.write(...)` (`ageVerified:true`, or
    `loyalty:{applied:true, membershipNumber}`). Returns `{ verified, gates }`.
  - `POST /credential-gate/:kind/demo` → instant-demo: write the store, return ok.

**4. `app.ts`**
- `registerCredentialGate(app)` alongside the existing gates.
- `GET /checkout/verification-status` → `{ ageVerified, loyalty }` from
  `verificationStore` (read-only; the browser polls it after opening a gate).

**5. `server.ts`** (MCP tools)
- Price functions (`readPriced`, `setQuantity`, `addToCart`, `removeFromCart`)
  read `verificationStore` and pass `{ ageVerified, loyaltyApplied }` into
  `priceCart` so every cart result carries verification + discount.
- New tools (so no-GUI hosts like Claude Code work too):
  - `verify-age` → returns the `/credential-gate/age` link to share.
  - `apply-loyalty` → returns the `/credential-gate/loyalty` link.
  - `get-verification-status` → reports age/loyalty state.
- `checkout` tool: if the cart `hasAgeRestricted` and not `ageVerified`, return
  `isError` with a message to verify age first (mirrors the disabled button).
  The order snapshot carries the discounted `total`/`discount`.
- `browse-products` description text mentions the 21+ gate and the loyalty
  option so the agent drives the flow correctly.

**6. `src/app.tsx`** (widget)
- Alcohol cards show a `21+` badge.
- Footer: when `hasAgeRestricted && !ageVerified` → **Checkout disabled** + a
  **"Verify age (21+)"** button that opens the age gate, polls
  `/checkout/verification-status`, and on success refreshes the cart (`get-cart`)
  so Checkout enables.
- An **"Apply loyalty discount"** button (hidden once applied) opens the loyalty
  gate; on success the footer/summary shows a `−10% loyalty` discount line and
  the new total.
- Same behavior in all three host modes. In **standalone mode**, the gate
  buttons mock the result locally (toggle `ageVerified`/`loyaltyApplied`) so the
  UI logic is demonstrable without a host or wallet.

**7. `checkout.ts` / order confirmation**
- The encoded `Order` carries `subtotal`/`discount`/`total`; the checkout page
  and `demoCompletedOrder` reflect the discounted total.
- The in-widget confirmation panel + `get-order-status` show a `discount` line
  and an "Age verified" gate entry when applicable.

## Testing

Layered so most of it needs no wallet and no special browser, following the
repo's `vitest` + fixtures convention:

- **Unit (`npm run test`):** `priceCart` discount + flags; `dcql.ts` builders;
  `verify.ts` against VP-token fixtures (adapt a2ui's `backend/tests` fixtures);
  `verificationStore`; the `checkout`/`verify-age`/`apply-loyalty` tools and the
  `/checkout/verification-status` route via `supertest`.
- **Standalone UI (`npm run dev`):** `mcp-app.html?standalone` — badges,
  disabled Checkout, verify/loyalty buttons, discount line (mocked gates).
- **Gate pages + server (`npm run build && node dist/main.js`):** open
  `/credential-gate/age` directly; the instant-demo button drives the full
  store→poll→enable flow. MCP Inspector for the tools.
- **Real DC path (optional):** Chrome 141+ (`chrome://flags#web-identity-digital-credentials`
  for localhost) + a wallet with an mDL — same setup as `dc-payment/README.md`.
- **End-to-end:** Claude Desktop (and other hosts) pointed at a tunnel/deploy.

## Out of scope

- Cryptographic trust verification of the mdoc (issuer/device signatures) —
  the existing payment gate already documents this as future work.
- Per-item / region-specific alcohol pricing rules (discount is whole-cart).
- Hand-edit-proof server enforcement of the checkout link.
- Persisting verification per-user/per-conversation (it is demo-global, like
  the cart).
