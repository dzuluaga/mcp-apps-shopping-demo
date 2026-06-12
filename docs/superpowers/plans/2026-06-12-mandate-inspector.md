# Mandate Inspector Implementation Plan (issue #11)

**Goal:** `/payment-gate/inspect` — a jwt.io-style page: paste an AP2-shaped mandate JSON
or a base64url order token; see the structured fields and the deterministic gates as live
green/red badges, plus the settlement block when the pasted artifact matches the recorded
completed order.

**Architecture:** One new self-contained module `payment-gate/inspect.ts` registering two
routes: `GET /payment-gate/inspect` (server-rendered page, inline client JS, esc()
everywhere — paste input is attacker-controlled by definition) and
`POST /payment-gate/inspect/validate` (JSON: detect artifact kind, run the real
`runGates`/`runDcGates` server-side — the same functions the live flow uses, no logic
duplicated into browser JS — and attach the recorded settlement on orderId match).
Branch `feat/mandate-inspector`, stacked on `feat/hedera-settlement` (#10).

**Tasks** (TDD inline; one combined spec+quality review pass over the whole diff at the
end — proportionate to a one-module feature; the security-sensitive surface gets explicit
hostile-input tests):

1. `payment-gate/inspect.ts` — `inspectArtifact(input, origin)` pure-ish core:
   - JSON with `type === "ap2.PaymentMandate"` + `userAuthorization.type === "webauthn.assertion"` → `kind: "passkey-mandate"`, gates = `runGates`
   - same with `userAuthorization.type === "openid4vp-dc-api"` → `kind: "dc-mandate"`, gates = `runDcGates(mandate, origin)` (decode failures inside gate fns must not 500 — wrap)
   - base64url that `decodeOrder`s → `kind: "order-token"`, decoded order, no gates (note: tokens are unsigned and non-authoritative)
   - otherwise → `kind: "unknown"` + error message
   - settlement: `orderStore.read()` orderId match → attach record
2. Routes + page: textarea, Inspect button, structured render (cart lines, payment,
   authorization, payee, expiry, signature block), gate badges with detail lines,
   settlement card + HashScan link, mock-signer honesty note. All dynamic values through
   the client `esc()` helper.
3. Wire `registerInspectRoutes(app)` in `app.ts`; project-layout bullet in README;
   gate-page receipt gets a one-line "Inspect this mandate →" link to the page.

**Tests** (`payment-gate/inspect.test.ts` + page pins):
- passkey mandate (via `buildPasskeyMandate`) → 4 green gates; hand-tampered amount → gate 1 red
- dc mandate shape routed to `runDcGates` without throwing on junk vpToken
- order token → decoded fields + non-authoritative note; garbage → kind unknown
- settlement attached only when orderStore's record matches the artifact's orderId
- page HTML pins: esc() applied to pasted-derived values, honesty note present
- hostile inputs: script-tag JSON values, huge input (size cap), malformed base64
