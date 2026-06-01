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

## The four gates

`runGates(mandate)` in `payment-gate/mandate.ts` validates the mandate. Each gate
is **re-derived from the mandate's own fields** — no gate trusts a `verified`
boolean handed to it:

1. **Amount integrity** — re-sums the cart line totals and checks they equal both
   `payment.amount` and `cart.total`. Passkeys do not cryptographically sign the
   amount (that is the DC gate's job, below), so passkey amount-binding is a
   *consistency* check, not cryptographic proof.
2. **Authorization present** — the `userAuthorization` is structurally a
   `webauthn.assertion` with a credential id.
3. **User verification** — the authenticator asserted user verification (`uv`).
4. **Subject binding** — the mandate `subject.credentialID` matches the
   authorization's `credentialID`.

The receipt rendered on the page shows each gate's pass/fail and its detail line.

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
difference — `rpID`/`origin` binding and the four gates are identical.

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
