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
