# Payment Gate (passkey authorization)

The checkout hand-off used to end at a mock **"Place order"** button that did
nothing. This module replaces it with a real **WebAuthn authorization
ceremony**: at the checkout page you click **Authorize payment**, confirm the
exact amount with your device's secure element (Touch ID, Windows Hello, or a
phone via cross-device sign-in), and the server produces a structurally
[AP2](https://github.com/google-agentic-commerce/AP2)-shaped **Payment Mandate**
that passes four validation gates.

Nothing is charged. This is an authorization gesture over a real cryptographic
ceremony, not a payment integration.

## Where it sits in the flow

```
picker → cart → checkout tool → /checkout?order=<token>
                                      │  "Authorize payment"
                                      ▼
                          /payment-gate/passkey?order=<token>
                                      │  one WebAuthn ceremony (Touch ID)
                                      ▼
                          Payment Mandate + four-gate receipt
```

The gate is reached **only** from the existing `/checkout` page and reads the
order solely from the URL token. It never touches the cart.

## Stateless by design (serverless-correct)

The deployment is serverless (Vercel), so there is no reliable server memory
between the "get options" request and the "verify" request — they may land on
different invocations. Two pieces of ephemeral state are therefore carried in
tokens, not memory:

- **The order** rides in the `order` URL token (base64url JSON), the same token
  the checkout page already uses. The gate decodes it per request.
- **The WebAuthn challenge** rides in a `GATE_SECRET`-signed, time-limited HMAC
  token (`payment-gate/challengeToken.ts`). `issueChallenge` returns the
  challenge plus the token; `verifyChallenge` recovers the challenge only if the
  signature and expiry check out.

The gate adds **no new storage dependency**. (The cart's `CartStore` —
`MemoryCartStore` locally, `RedisCartStore` on Vercel — remains the only
server-side state in the app; the gate contributes none.)

A single registration ceremony (`verifyRegistrationResponse`) is used as the
authorization gesture — not register-then-authenticate — so there is one Touch
ID prompt and nothing is persisted.

## Mandate authorization & gates (AP2 SD-JWT)

The gate no longer mints a mock-signed mandate. After the WebAuthn ceremony, the
route hands the device evidence to the **AP2 sidecar** — a Python service
(`ap2-sidecar/`) wrapping the official
[AP2 SDK](https://github.com/google-agentic-commerce/AP2), called over HTTP via
`payment-gate/ap2Client.ts`. The sidecar mints a real **ES256 SD-JWT
PaymentMandate** and runs the validation gates. Each gate is **re-derived from
the mandate's own signed fields** — no gate trusts a `verified` boolean:

- **signature** — the SD-JWT issuer signature verifies (real crypto, via the
  SDK). This replaces the old `MOCK-DEV-SIGNER`.
- **amount_integrity** — the signed `payment_amount` (ISO-4217 minor units)
  equals the expected order total + currency.
- **mandate_fresh** — the signed `exp` window is still open.
- **payee_binding** — the signed `payee.id` matches this RP.
- **authorization_present / user_verification / subject_binding** — the device
  evidence carried in the mandate's `risk_data`: a `webauthn.assertion` with a
  credential id, `userVerified` true, and the payment instrument bound to that
  credential.

The WebAuthn assertion itself is verified in TS (`@simplewebauthn`) **before** the
mandate is built — the SDK verifies the SD-JWT envelope, not the passkey. The
receipt rendered on the page shows each gate's pass/fail and its detail line.

> See `ap2-sidecar/README.md` and the migration plan
> `docs/superpowers/plans/2026-06-05-ap2-python-sdk-sidecar.md`. Amounts are
> dollars in the TS app and converted to minor units inside the sidecar.

## Running it locally

WebAuthn requires a **secure context**: HTTPS, or `http://localhost` (which
browsers treat as secure). It will not run over a plain LAN IP.

```bash
npm run build
PORT=3001 GATE_SECRET=dev-secret node dist/main.js
```

Then drive the flow from an MCP host (add to cart → `checkout`), or open a
checkout link directly at `http://localhost:3001/checkout?order=<token>` and
click **Authorize payment**.

- `GATE_SECRET` — HMAC key for challenge tokens. If unset, a per-process random
  value is used (fine locally because one process spans issue + verify).
  **Required in production:** on serverless the "get options" and "verify"
  requests may hit different instances, so without a stable shared `GATE_SECRET`
  every cross-instance verify fails the signature check.
- The `@simplewebauthn/browser` ESM is served same-origin from
  `/payment-gate/lib/sw/` (no CDN).

## The cross-device channel (FIDO caBLE)

Cross-device authorization needs **no extra code** — it is the same ceremony over
a different transport. When the browser's passkey prompt offers **"use a
phone"**, it drives the ceremony to a nearby device over
[caBLE](https://fidoalliance.org/) (the FIDO cloud-assisted BLE / "hybrid"
transport): the desktop shows a QR code, the phone scans it, BLE proximity plus
an encrypted tunnel establish the channel, and the biometric prompt happens on
the phone.

The crucial property: **the phone never talks to our server**. The assertion
travels phone → desktop browser over the caBLE tunnel, and the desktop posts it
to `/payment-gate/passkey/verify`, where our server verifies it exactly the same
way as a same-device assertion. From the server's perspective there is no
difference — `rpID`/`origin` binding and the AP2 mandate gates are identical.

This is what makes "authorize on your phone a payment an agent prepared on your
laptop" work without any device-pairing infrastructure of our own.

### Verified

> _(Record manual cross-device verification here once run on the deployed HTTPS
> origin: open checkout → Authorize → "use a phone" → scan → biometric → confirm
> the desktop renders the four-gate receipt.)_

## What's deferred

This is the **passkey** gate. A separate follow-up adds the **Digital Credentials
(DC) payment gate** — mdoc/CBOR decode, OpenID4VP, a QR page, and *cryptographic*
amount-binding (where the amount really is signed). The passkey page is where the
fallback *to* that gate will live.
