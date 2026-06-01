# caBLE / Cross-Device Payment Gate — Design

**Date:** 2026-05-31
**Status:** Approved (design); pending spec review before planning.

## Goal

Turn the Product Picker's checkout hand-off into the **authorization moment**.
Today `checkout` snapshots the cart into a stateless order and the `/checkout`
page ends with a mock "Place order" button (client-side confirmation only). This
adds a real authorization ceremony in its place: the user authorizes the **exact
cart amount** on a server-served page, producing a structurally-AP2 Payment
Mandate validated against four gates. The end state includes the **DC payment
gate** with real amount-binding carried cross-device over **FIDO caBLE**.

This is the future "account/connector + authorization" step explicitly deferred
in `2026-05-29-checkout-handoff-design.md` (Out of scope: "Real payment / real
merchant integration", "OAuth / account-connector step").

## Motivation

`ucp-agentic-tester` already proves the authorization ceremony end to end (see
its `spike/passkey-gate` and `spike/dc-gate-probe` / `spike/dc-payment-gate`).
That repo is a Claude Code plugin whose gates run as **ephemeral localhost
helpers**. This project is a hosted MCP app (added as a connector, deployed to
Vercel). The integration goal is to bring the *technique* in — not couple to the
plugin at runtime — as **server-served pages** that work identically on
`localhost` and on `https://mcp-apps-nine.vercel.app`.

The two repos are the two halves of one agentic-commerce story: mcp-apps *builds
and edits the cart conversationally*; the payment gate *authorizes the exact
amount on hardware the user owns*. The agent never places the order or takes
payment.

## Design principles

- **Decomposed and learnable.** The gate lives in a self-contained top-level
  `payment-gate/` directory. Each gate is its own folder with its own README and
  tests, mounted via a `register(app)` function. A reader can open one folder and
  understand one concept; the folder could be lifted out without untangling the
  cart code. The integration boundary (the `/checkout` page link) stays thin.
- **Real server page, not a localhost helper.** Pages are served by the existing
  `createApp()` Express app, so they deploy to Vercel and run over HTTPS with no
  bridge. WebAuthn and the Digital Credentials API both require a secure context;
  Vercel provides HTTPS and `localhost` is exempt by the platform.
- **Stateless, matching the repo's ethos.** The order already rides in the URL
  (base64url). The WebAuthn challenge and the DC reader's ephemeral key ride in
  **server-signed tokens** (HMAC / sealed with a `GATE_SECRET`), so there is no
  per-request server memory and **no new persistence/storage dependency** for the gate. This is
  required for serverless correctness on Vercel (no module memory between
  invocations).
- **The phone never talks to our server.** For the DC gate, the browser + the
  FIDO relay own the device-to-device leg; the wallet's response returns to the
  *desktop* browser (the one that called `navigator.credentials.get`), which
  POSTs it to our server for decryption + verification. No phone-reachable
  `response_uri`.

## Scope

### In scope

1. A `payment-gate/` directory with shared helpers (`mandate.ts`, `origin.ts`,
   `challengeToken.ts`) and two gate modules (`passkey/`, `dc-payment/`).
2. An **"Authorize payment"** affordance on the existing `/checkout` page that
   surfaces the order's binding fields (amount, currency, payee, order id) and
   links to a gate page, replacing the mock "Place order" button as the terminal
   step.
3. **Passkey gate** (same-device + cross-device via caBLE): a server-served page
   running a WebAuthn ceremony, server-side assertion verification, and a
   resulting mock AP2 Payment Mandate.
4. **DC payment gate** (cross-device, caBLE): a server-served QR page running the
   Digital Credentials API with OpenID4VP `transaction_data` bound to the cart's
   amount + payee; server-side decryption + verification of the wallet
   presentation; a mandate carrying the wallet-signed `transaction_data_hash`.
5. A shared **four-gate** validator in `mandate.ts`, with the gate set differing
   per modality (see "The four gates").
6. Mounting both gates into `createApp()` so they serve locally and on Vercel.
7. Unit tests for every pure module and recorded-fixture tests for the verifiers.

### Out of scope

- **Real signing.** The mandate signature stays `MOCK-DEV-SIGNER` (a dev signer),
  as in the spike. Production replaces this with AP2-conformant SD-JWT signing in
  a real payment adapter.
- Real money, a real merchant, or a real issuer/ASPSP trust check.
- Persisting WebAuthn credentials across sessions (each ceremony is fresh).
- Multi-user / per-conversation carts (still demo-global, per existing design).
- Changing the cart, the picker UI, or the existing tools. The gate attaches at
  the checkout hand-off only.

## Architecture

```
checkout tool ──snapshot──▶ order (base64url in URL)        [existing]
                                  │
        GET /checkout?order=<token>   (existing mock page)
                                  │  + "Authorize payment"
                                  ▼
   GET /payment-gate/passkey?order=<token>     OR    /payment-gate/dc-payment?order=<token>
                                  │                                  │
   browser runs WebAuthn ceremony │            browser runs Digital Credentials ceremony
   (same-device or phone/caBLE)   │            (cross-device QR over caBLE)
                                  ▼                                  ▼
   POST /payment-gate/passkey/verify          POST /payment-gate/dc-payment/verify
                                  │                                  │
   server verifies assertion,    │            server decrypts + verifies wallet
   builds AP2 mandate,           │            presentation, builds AP2 mandate,
   runs 4 gates                  │            runs 4 gates (incl. amount binding)
                                  ▼                                  ▼
              page renders mandate + per-gate report (receipt)
```

Nothing on the cart path changes. The gate is reached only from the checkout
page and reads the order solely from the URL token.

## Components

### `payment-gate/origin.ts`
Derive `{ rpID, origin }` from an incoming request. `rpID` is the request host
without port (`localhost` in dev, `mcp-apps-nine.vercel.app` in prod); `origin`
is `<proto>://<host>`. Honors `x-forwarded-host` / `x-forwarded-proto` (Vercel
sets these). Pure function over a minimal `{ headers, host, protocol }` shape so
it is unit-testable without a live request.

### `payment-gate/challengeToken.ts`
Stateless WebAuthn challenge handling. `issueChallenge()` returns a random
challenge plus a signed token = `base64url(challenge).HMAC-SHA256(challenge|exp,
GATE_SECRET)` with a short expiry (default 120s). `verifyChallenge(token)`
recomputes the HMAC, checks expiry, and returns the original challenge or throws.
`GATE_SECRET` comes from env; in dev it falls back to a per-process random value
(fine because a single process spans issue+verify locally).

### `payment-gate/mandate.ts`
Shared, ports `mandate-wrapper.js`. `buildPasskeyMandate(assertion, order)` and
`buildDcMandate(presentation, order)` produce a `type: "ap2.PaymentMandate"`,
`version: "0.1-mock"` object embedding `cart`, `payment`, and `userAuthorization`
evidence, with a `MOCK-DEV-SIGNER` signature (sha256 digest of the body).
`runGates(mandate)` returns the four `{ gate, pass, detail }` results; the gate
set is selected by `mandate.userAuthorization.type`
(`webauthn.assertion`/`webauthn.attestation` vs `openid4vp.dc`). Gate 1 is
**re-derived from the mandate's own fields** — it does not trust a `verified`
flag.

### `payment-gate/passkey/`
- `routes.ts` — `registerPasskeyGate(app)` mounts `GET /payment-gate/passkey`
  (the page), `GET /payment-gate/passkey/options` (registration options +
  challenge token, RP/origin from `origin.ts`), `POST /payment-gate/passkey/verify`
  (assertion + challenge token → verify → mandate + gates).
- `page.ts` — server-rendered HTML. Loads `@simplewebauthn/browser` ESM from a
  same-origin static path (no CDN, per the spike's finding). Decodes the order
  token to show the amount being authorized. Drives the ceremony, POSTs the
  result, renders the receipt. Cross-device is the browser's "use a phone" path —
  same code; caBLE is the browser's doing.
- `verify.ts` — `@simplewebauthn/server` `verifyRegistrationResponse` with
  `expectedChallenge` recovered from the token and `expectedOrigin`/`expectedRPID`
  from `origin.ts`; `requireUserVerification: true`. **Single registration
  ceremony as the authorization gesture** (stateless-friendly: one Touch ID, no
  credential to persist). Returns the verified authenticator info.
- `passkey.test.ts` — verifier against a recorded assertion fixture; bad/expired
  challenge → throws; resulting mandate passes its four gates.

### `payment-gate/dc-payment/`
- `txData.ts` — ports `tx-data.js`: `buildTransactionData(order)` (amount +
  currency + payee from the order, fresh `transaction_id`), `encode`, and
  `hashTransactionData` (SHA-256, base64url). Single source of truth for the
  binding.
- `routes.ts` — `registerDcPaymentGate(app)` mounts `GET /payment-gate/dc-payment`
  (QR page), `GET /payment-gate/dc-payment/request` (OpenID4VP request with the
  bound `transaction_data` and the reader's ephemeral public key; the ephemeral
  private key is sealed into a stateless token with `GATE_SECRET`), and
  `POST /payment-gate/dc-payment/verify` (wallet presentation + the sealed key
  token → decrypt → verify → mandate + gates).
- `page.ts` — server-rendered page running `navigator.credentials.get({digital})`.
  Feature-detects the Digital Credentials API; if absent, shows a "needs Chrome
  141+ / a provisioned wallet" notice and a link back to the passkey gate.
- `verify.ts` — decode the mdoc/CBOR presentation (ports the
  `mdoc`/`vp-inspect` decode helpers from `spike/dc-gate-probe`), extract and
  re-derive the `transaction_data_hash`, build the mandate carrying it.
- `dc-payment.test.ts` — `txData` hashing; verifier against a recorded
  presentation fixture; the amount-binding gate passes only when the signed hash
  and the cart amount/payee agree.

### Touched existing files
- `checkout.ts` — in `renderCheckoutPage`, replace the lone "Place order" button
  with an "Authorize payment" panel showing the binding fields and linking to
  `/payment-gate/passkey?order=<token>` (primary) and `/payment-gate/dc-payment?order=<token>`
  (cross-device). Add a `buildBindingFields(order)` helper for the displayed
  amount/payee. The existing 404 path is unchanged.
- `app.ts` — call `registerPasskeyGate(app)` and `registerDcPaymentGate(app)`
  alongside the `/mcp` and `/checkout` wiring, and serve the
  `@simplewebauthn/browser` ESM static path.
- `package.json` — add `@simplewebauthn/server`, `@simplewebauthn/browser`,
  `jose`. The mdoc/CBOR decode helpers are ported into `dc-payment/` from the
  spike rather than adding a heavy dependency.

## Data flow / state

- **Order** — unchanged: a stateless base64url snapshot in the URL. The gate
  reads amount/payee from it; the decoded order is **not** authoritative for
  payment (it's unsigned), which is fine for this mock — the *mandate* is the
  authorization artifact.
- **Challenge / reader key** — stateless signed tokens (`GATE_SECRET`), never
  stored server-side.
- **Mandate** — returned to the browser and rendered; not persisted.
- The gate **never reads or writes the cart**, preserving the thin boundary.

## Error handling

- Bad/expired/malformed order token → existing 404 page.
- Expired or tampered challenge / key token → `400`; the page offers a retry.
- Ceremony cancelled, no authenticator, or user-verification not satisfied →
  the page shows a clear retry and renders **no** mandate.
- Digital Credentials API unsupported (no flags / no wallet) → the DC page
  feature-detects and shows a requirements notice + a fallback link to the
  passkey gate.
- A failed gate evaluation renders the per-gate report with the failing gate
  marked — it does not 500.
- No gate failure path touches the cart or the order.

## Testing

- **Unit (deterministic, CI-safe):**
  - `origin.ts` — host/proto derivation incl. `x-forwarded-*`.
  - `challengeToken.ts` — issue/verify round-trip, expiry, tamper rejection.
  - `mandate.ts` — mandate shape per modality; `runGates` pass and fail cases for
    all four gates (Gate 1 re-derived, not trusting a flag).
  - `txData.ts` — encode + SHA-256 hash; amount/payee taken from the order.
  - `passkey/verify.ts`, `dc-payment/verify.ts` — against **recorded fixtures**
    captured from the `ucp-agentic-tester` spikes (assertion JSON; wallet
    presentation). Bad input → rejected.
  - Page render — gate pages include the bound amount and the expected client
    script; DC page renders the unsupported-API notice when asked to.
- **Manual / live (environment-bound, documented in each module README):**
  same-device Touch ID; cross-device passkey via phone (exercises caBLE); DC gate
  on Chrome 141+ with a provisioned wallet. These are not automated.

## Incremental ladder

Each rung is one mergeable, demoable commit. `main` stays working throughout; the
work lives on a `feat/cable-payment-gate` branch with a commit per rung. Files
stay flat under `payment-gate/` (no folder-per-rung).

1. **Docs** — `payment-gate/README.md` (the concept + a "### The cross-device
   channel (FIDO caBLE)" section framed around the checkout hand-off); link it
   from the top-level README Demo area; check the ROADMAP item. No code.
2. **Foundation** — `mandate.ts`, `origin.ts`, `challengeToken.ts` + their tests.
3. **Passkey gate, same-device** — `passkey/` mounted; checkout page links to it;
   verified manually with Touch ID.
4. **Passkey gate, cross-device** — the same code via the browser's phone/caBLE
   path; primarily a test + README rung documenting the caBLE leg.
5. **DC payment gate** — `dc-payment/` with `txData`, the QR page, the verifier,
   and the amount-binding gate; the full caBLE amount-bound target.

## Decisions carried / deferred

- **Registration-as-gesture** for the passkey gate (single ceremony, stateless)
  rather than register-then-authenticate; the DC gate is where real amount
  binding lives.
- **No storage dependency for the gate.** Ephemeral state is carried in
  `GATE_SECRET`-signed tokens to stay stateless on serverless. (The in-memory
  global cart Map in `server.ts` remains the only server-side state; the gate
  adds none.)
- **Port, don't couple.** The mdoc/CBOR decode + verification technique is ported
  from `ucp-agentic-tester` spikes into `dc-payment/`; the plugin is not a runtime
  dependency.
- Real SD-JWT signing, real merchant/ASPSP trust, and credential persistence are
  future work, consistent with the spike's own "what's real vs mocked" framing.
