# Migrate Payment Mandates to the AP2 Python SDK (sidecar) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-rolled, mock-signed "AP2-shaped" payment mandates (`version: "0.1-mock"` for passkey, `"0.1-dc"` for DC) with **real AP2 SD-JWT PaymentMandates produced and verified by Google's official AP2 Python SDK** (`ap2.sdk`, https://github.com/google-agentic-commerce/AP2/tree/main/code/sdk/python/ap2/sdk). Cover **both** the passkey and DC payment gates.

**Decision (locked in with the requester):**
- **Approach B — Python sidecar.** The backend stays TypeScript/Node; a new Python service wraps the AP2 SDK. The existing `payment-gate/` TS routes call it over HTTP. Chosen because the SDK is Python-only and there is a hard requirement to use *that specific SDK* (not reimplement the protocol in TS).
- **Scope — both gates.** Migrate the mandate envelope for both `payment-gate/passkey/` and `payment-gate/dc-payment/`.

## The one conceptual shift (read before implementing)

The AP2 SDK mints **SD-JWT mandates signed with ES256 keys** (`MandateClient.create / present / verify`, SD-JWT + KB-SD-JWT delegation hops). That is a *different cryptographic object* from what the gates produce today:

- **Passkey gate** → a WebAuthn assertion (user-presence proof; does **not** sign the amount).
- **DC gate** → an mdoc DeviceResponse over OpenID4VP (signs the amount hash).

**The SDK does not verify WebAuthn assertions or mdoc signatures.** Therefore the migration model is:

> The AP2 **SD-JWT PaymentMandate becomes the canonical envelope.** The WebAuthn assertion / mdoc DeviceResponse become **evidence claims carried inside** that mandate. The SDK provides mandate-envelope authenticity (signature, delegation chain, selective disclosure); the existing device-layer code (`@simplewebauthn`, mdoc/CBOR, JWE) still proves user-presence / amount-binding.

This maps ~1:1 onto today's code: `buildPasskeyMandate()` / `buildDcMandate()` already emit a JSON mandate, and `runGates()` / `runDcGates()` validate it. We are (a) replacing the `MOCK-DEV-SIGNER` envelope with a real SD-JWT one, and (b) moving the **signature/chain** gates into the SDK while **keeping** the device-evidence gates (userVerified, mdoc auth blocks present, credential expiry, amount/subject binding).

**Expectation to set with stakeholders:** "use the AP2 SDK" ≠ "the SDK verifies the passkey." The SDK verifies the SD-JWT envelope; the device proof rides inside it as a claim.

## Architecture

```
 TS app (≈90% unchanged)                       Python sidecar (new: ap2-sidecar/)
 ──────────────────────                        ─────────────────────────────────
 passkey/routes.ts  ┐                          FastAPI + uvicorn
   verify.ts (WebAuthn)  ─ evidence ─┐         holds issuer/holder ES256 JWKs
 dc-payment/routes.ts ┘              ├─ HTTP ─▶ POST /ap2/payment-mandate
   verify.ts (mdoc/JWE) ─ evidence ─┘            → MandateClient.create(...)  → SD-JWT
                                                POST /ap2/payment-mandate/verify
 orderStore ◀─ {mandate, gates[]} ────────────   → MandateClient.verify(...) + claim checks
```

`payment-gate/` remains the only integration seam (it already exchanges only `Order` in / `CompletedOrder` out), so nothing upstream — MCP tools (`server.ts`), cart, `checkout.ts` — changes.

**AP2 SDK surface we depend on** (verified from `ap2/sdk/mandate.py`):
- `MandateClient.create(payloads, issuer_key, sd=None)` → root SD-JWT string.
- `MandateClient.present(holder_key, mandate_token, payloads, ..., aud, nonce)` → delegation hop (`~~`-joined).
- `MandateClient.verify(token, key_or_provider, payload_type=None, expected_aud=None, expected_nonce=None, clock_skew_seconds=300)` → `SdJwtMandate[T]` or per-hop payload list.
- Pydantic models under `ap2/sdk/generated/` (`PaymentMandate`, `OpenPaymentMandate`, `CheckoutMandate`, …) define the claim shape we must populate.
- `ReceiptClient` (`receipt_wrapper.py`) — optional, for a signed completion receipt.

## Tech stack

- **Sidecar:** Python 3.11+, FastAPI + uvicorn, the vendored/installed `ap2.sdk` (ES256 / SD-JWT, depends on `cryptography` + `pydantic`), pytest.
- **TS:** unchanged stack (Express 5, MCP SDK, vitest, `@simplewebauthn`, `jose`, `cbor-x`, `@peculiar/x509`) plus a thin `payment-gate/ap2Client.ts` fetch wrapper.

## File structure

```
ap2-sidecar/                     NEW — Python service
  pyproject.toml                 deps: fastapi, uvicorn, ap2-sdk (git/vendored), cryptography, pydantic
  app.py                         FastAPI app + routes
  keys.py                        load issuer/holder ES256 JWK from AP2_ISSUER_JWK, dev-fallback generate
  mandate_build.py               order+evidence -> AP2 PaymentMandate payload -> MandateClient.create()
  mandate_verify.py              MandateClient.verify() + amount/claim gate checks -> GateResult[]
  models.py                      request/response Pydantic models (the TS<->Python contract)
  vendor/ap2/...                 (only if not pip-installable) vendored SDK package
  tests/test_build.py  tests/test_verify.py  tests/test_roundtrip.py

payment-gate/ap2Client.ts        NEW — typed fetch wrapper to the sidecar (AP2_SIDECAR_URL)

api/ap2/index.py                 NEW — Vercel Python function re-exporting ap2-sidecar app (deploy path)
```

**Touched existing files:** `payment-gate/passkey/routes.ts` + `mandate.ts`, `payment-gate/dc-payment/routes.ts` + `mandate.ts`, `orderStore.ts` (carry SD-JWT + SDK gates in `CompletedOrder`), `main.ts` (spawn sidecar in stdio mode), `package.json` (scripts), `vercel.json` (Python function), `CLAUDE.md` + both payment-gate READMEs, `ROADMAP.md`.

**Files kept as-is (device layer):** `payment-gate/passkey/verify.ts`, `payment-gate/dc-payment/{verify.ts,mdoc.ts,txData.ts,readerContext.ts,request.ts,page.ts}`, `payment-gate/{origin.ts,challengeToken.ts}`. The four-gate `runGates()`/`runDcGates()` functions shrink — their signature/amount-envelope role moves to the sidecar; their device-evidence extraction feeds the sidecar request.

---

### Task 0: De-risk the SDK (do this first — it gates the design)

**Files:** none committed; throwaway spike.

- [x] **Step 1: Resolve packaging.** Confirmed: the SDK has **no `pyproject.toml`** under `code/sdk/python/` (only `code/samples/python/` does). The git-subdirectory pip install does **not** work → **must vendor**. The `git+...#subdirectory` form is therefore out.
  Verified `from ap2.sdk.mandate import MandateClient` succeeds with the package dir on `PYTHONPATH`.

- [x] **Step 2: Round-trip spike.** Done — `create([PaymentMandate], issuer_key)` → real ES256 SD-JWT; `verify(token, issuer_pub, payload_type=PaymentMandate)` returns the typed payload; embedded evidence survives; wrong key → `InvalidJWSSignature`. `PaymentMandate` schema captured (see findings).

- [x] **Step 3: Decide deploy target.** **Decision: Vercel Python function, with the SDK vendored.** Footprint is 44 MB deps + 560 KB vendored `ap2/` — well under Vercel's 250 MB unzipped limit; all deps ship manylinux/abi3 wheels (no compile). Final confirmation deferred to first deploy.

**STOP / review gate:** ✅ Cleared — schema known, deploy target chosen. Task 1 may proceed.

---

### Task 0 — FINDINGS (2026-06-05 spike)

Spike ran against AP2 commit **`e1ea56db72a6385bce3e5c1112b3a56ce60acb43`** (pin this when vendoring). Spike lives at `/tmp/ap2-spike/` (throwaway: cloned repo + venv + `roundtrip.py`).

**Packaging → VENDOR.** No installable package for the SDK. Copy `code/sdk/python/ap2/` (560 KB) into the sidecar and pin the commit above. Set it on the import path (package root = the dir *containing* `ap2/`).

**Runtime deps** (all wheels, no build step): `cryptography==48.0.0`, `jwcrypto==1.5.7`, `pydantic==2.13.4` (+ `pydantic-core`), `sd-jwt==0.10.4` (transitive: `pyyaml`, `cffi`, `pycparser`, `annotated-types`, `typing-extensions`, `typing-inspection`). Note: the SDK has its **own** `ap2/sdk/sdjwt/` internals **and** depends on the external PyPI `sd-jwt` package (`from sd_jwt.holder import SDJWTHolder`) — both are required.

**Python version:** SDK declares `requires-python >=3.11`. Installed and ran cleanly on the host's **3.14**, but pin the sidecar to **3.12** to match the Vercel Python runtime.

**Keys = jwcrypto `JWK`, ES256 / P-256.** Pattern (from `conftest.py`): `ec.generate_private_key(ec.SECP256R1())` → `JWK.from_pyca(key)` (add a `kid`). `verify` needs a `JWK` for single tokens, or a `(ParsedToken)->JWK` provider for `~~` chains. → `keys.py` (Task 1) loads `AP2_ISSUER_JWK` as a jwcrypto JWK; dev fallback generates a P-256 key.

**Confirmed `MandateClient` API:** `create(payloads: list, issuer_key: JWK, sd=None) -> str` (signs `payloads[0]`; `sd=None` auto-derives selective-disclosure from the model's annotations). `verify(token, key_or_provider, payload_type=None, expected_aud=None, expected_nonce=None, clock_skew_seconds=300) -> SdJwtMandate[T] | list[dict]` (read payload via `.mandate_payload`). `present(holder_key, mandate_token, payloads, ..., aud, nonce)` for chain hops.

**`PaymentMandate` schema** (`ap2/sdk/generated/payment_mandate.py`, `vct='mandate.payment.1'`):
| field | type | note |
|---|---|---|
| `transaction_id` | `str` (req) | base64url hash of a `checkout_jwt`; for the demo, hash our order token |
| `payee` | `Merchant{id, name, website?}` (req) | `id` ← our payee/rpID, e.g. `did:web:product-picker.local` |
| `payment_amount` | `Amount{amount:int, currency:str}` (req) | **`amount` is integer MINOR units** (27999 = $279.99) |
| `payment_instrument` | `PaymentInstrument{id, type, description?}` (req) | |
| `pisp` | `PISP?` | optional |
| `execution_date` | `str?` (ISO8601) | absent = immediate |
| `risk_data` | `dict?` | free-form — **used in spike to carry device evidence inside the signed mandate** |
| `iat` / `exp` | `int?` (unix epoch) | mandate validity window |

**Refinements pushed into later tasks:**
- **Amount conversion (Task 2/4):** our `Order`/`priceCart` totals are dollars; AP2 `Amount.amount` is integer minor units → multiply by 100 (round) at the TS→sidecar boundary, and divide back when mapping to `CompletedOrder`.
- **Evidence embedding (Task 2):** confirmed working — passkey assertion summary / dc `transaction_data_hash` ride in `risk_data` (or a custom claim) inside the signed mandate. The proper-AP2 alternative is a richer `CheckoutMandate` (UCP `Checkout`/`LineItem`/`Total` models exist) referenced by `transaction_id`; keep that as the follow-up, start with `risk_data`.
- **`transaction_id` (Task 2):** set to a sha256-b64url of our existing checkout order token, tying the mandate to the specific checkout.

---

### Task 1: Sidecar skeleton + keys

**Files:** create `ap2-sidecar/{pyproject.toml,app.py,keys.py,models.py}`, `ap2-sidecar/tests/`.

- [x] **Step 1:** `pyproject.toml` — fastapi, uvicorn[standard], cryptography, jwcrypto, pydantic, sd-jwt; `[dev]` extra = pytest + httpx. The AP2 SDK is **vendored** at `ap2-sidecar/vendor/ap2/` (commit pinned in `vendor/ap2/VENDOR.txt`), not a pip dep; `_vendor.py` prepends `vendor/` to `sys.path`.
- [x] **Step 2:** `keys.py` — `issuer_key()` / `issuer_public_key()` load an ES256/P-256 JWK from `AP2_ISSUER_JWK`, dev fallback generates an ephemeral key with a logged warning (mirrors `gateSecret()`). (Holder key for delegation deferred with Task 2 Step 3.)
- [x] **Step 3:** `models.py` — the contract, field names mirroring the TS `Order`/`PricedCartLine` (camelCase) so no translation layer is needed:
  - `BuildRequest { order, channel: "passkey"|"dc", authorization, payeeId? }` → `BuildResponse { mandate, mandateId }`
  - `VerifyRequest { mandate, expectedAmount, expectedCurrency, expectedPayeeId? }` → `VerifyResponse { valid, gates, payload? }`
  - `GateResult` serializes as `{gate, pass, detail}` (attr `passed`, wire alias `pass`) — matches TS `GateResult`. Verified by `test_vendor.py::test_gate_result_wire_alias`. Amounts on the wire are **dollars**; minor-units conversion stays inside the sidecar (Task 2).
- [x] **Step 4:** `app.py` — FastAPI `GET /healthz` (imports the vendored `MandateClient` in-process as a vendoring probe). **`pytest` green: 4 passed** (`test_health.py` + `test_vendor.py`: SDK import, issuer-key round-trip, gate-alias). Also boot-verified under real `uvicorn app:app` over a socket.

  Extra scaffolding added this task: `_vendor.py`, `conftest.py` (puts sidecar root on path for tests), `README.md`, and `.gitignore` entries for `.venv/`/`__pycache__/`/`.pytest_cache/`.

---

### Task 2: Mandate build endpoint

**Files:** `ap2-sidecar/mandate_build.py`, `tests/test_build.py`.

- [x] **Step 1:** `mandate_build.py::build_payment_mandate` maps `OrderIn` → `PaymentMandate`: `payment_amount` = `Amount(to_minor_units(order.total), order.currency)` (**×100 dollars→minor units, rounded**); `payee` = `Merchant(id=payeeId, name=payeeId)`; `transaction_id` = `compute_sha256_b64url(order.id)` (binds mandate to the checkout); `payment_instrument` derived per channel; `iat`/`exp` = now / now+300s. The device evidence rides in `risk_data = {"channel", **authorization}` inside the signed mandate.
- [x] **Step 2:** `POST /ap2/payment-mandate` (`app.py`) → `build_mandate()` → `MandateClient.create([payload], issuer_key())` → `{ mandate, mandateId: "mandate_pm_<uuid>" }`.
- [ ] **Step 3 (deferred):** delegation chain (user-intent → cart → payment) via `present()`. Issuing a single PaymentMandate for now; chain tracked as the follow-up (also noted in Risks #5). The richer `CheckoutMandate` (UCP `Checkout`/`LineItem`) referenced by `transaction_id` is the same follow-up.
- [x] **Step 4:** `test_build.py` — both channels build a mandate that **cryptographically verifies** with the issuer public key; asserts minor-units amount (58700), payee, embedded evidence survive, and instrument id per channel; plus `to_minor_units` rounding (279.99→27999, float-drift guard) and invalid-channel → 422. **pytest green: 8 passed.** Live-curl confirmed over a real uvicorn socket (returns an `alg:ES256` SD-JWT).

---

### Task 3: Mandate verify endpoint (gates move here)

**Files:** `ap2-sidecar/mandate_verify.py`, `tests/test_verify.py`, `tests/test_roundtrip.py`.

- [x] **Step 1:** `POST /ap2/payment-mandate/verify` → `MandateClient.verify(token, issuer_public_key(), payload_type=PaymentMandate)`. Real SD-JWT crypto (replaces the mock-signature gate); on failure it **short-circuits** to a single `signature:false` gate with `payload:null`.
- [x] **Step 2:** Gates re-derived from the **signed** payload: `amount_integrity` (minor-units vs `expectedAmount`/`expectedCurrency`), `mandate_fresh` (signed `exp`), `payee_binding` (vs `expectedPayeeId`). Channel evidence (from `risk_data`): passkey → `authorization_present` / `user_verification` / `subject_binding` (instrument == credentialId); dc → `authorization_present` (auth blocks / tx-hash) / `credential_not_expired` (epoch or ISO) / `subject_binding` (instrument == disclosed instrumentId). Each emits `{gate,pass,detail}`.
  - **Division of labor documented in the module:** the SDK does the envelope crypto; the TS device layer (Task 4) does the real WebAuthn/mdoc + `transaction_data_hash` crypto and passes its attested results in `risk_data`; the sidecar re-derives the envelope/amount/subject gates and checks the evidence claims.
- [x] **Step 3:** `valid = all(g.pass)`.
- [x] **Step 4:** `test_verify.py` (8) isolates every gate's failure (bad signature, tampered amount, wrong subject, dc expired credential, unknown channel, wrong payee) + both happy paths; `test_roundtrip.py` (4) drives build→verify through the HTTP endpoints and asserts the `{gate,pass,detail}` wire shape. **pytest green: 20 passed total.**

---

### Task 4: TS integration

**Files:** create `payment-gate/ap2Client.ts`; modify `payment-gate/passkey/routes.ts` + `mandate.ts`, `payment-gate/dc-payment/routes.ts` + `mandate.ts`, `orderStore.ts`.

- [x] **Step 1:** `ap2Client.ts` — typed `buildMandate()` / `verifyMandate()` over global `fetch`, base URL from `AP2_SIDECAR_URL` (default `http://localhost:8787`). Passes `Order` through as-is (sidecar `OrderIn` mirrors the TS fields — no translation).
- [x] **Step 2:** `passkey/routes.ts` `POST /verify` — after `verifyPasskeyAssertion()`, builds the `authorization` evidence (credentialId/userVerified/deviceType/rpId/origin), calls `buildMandate({channel:"passkey", ...})` then `verifyMandate(...)`. `buildPasskeyMandate()` + `runGates()` removed; `mandate.ts` trimmed to `buildBindingFields` / `BindingFields` / `VerifiedAuthenticator`.
- [x] **Step 3:** `dc-payment/routes.ts` `POST /verify` — `verifyDcPresentation()` now returns **`DcEvidence`** (JWE decrypt + mdoc extraction + the re-derived wallet `amountBound` verdict); route hands it to the sidecar. `dc-payment/mandate.ts` repurposed `buildDcMandate`/`runDcGates` → `extractDcEvidence`; `verify.ts` returns evidence.
  - **Scope addition (preserves DC security):** the wallet-signed amount-binding can't be re-derived by the sidecar (it never sees the vp_token), so TS computes it and attests `amountBound`; added a sidecar gate **`amount_signature_bound`** (`risk_data.amountBound is True`) so the property stays an explicit gate. (+1 Python test.)
- [x] **Step 4:** Both routes map the sidecar verdict → `CompletedOrder`: `mandateId` = sidecar id, `gates` = sidecar gates, new optional `CompletedOrder.mandate` = the SD-JWT. Existing fields preserved (app.test.ts still green). Response keeps `{ mandate: {id, format, token}, gates, completed, binding }` so the page receipts (`mandate.id` + gates) need **no change**.
- [x] **Step 5:** **`npm run build` green** (typecheck + bundle + compile) and **`npm test` green: 99 passed / 1 skipped** (skip is the pre-existing `verify.fixture.test.ts`). Dead code deleted (`noUnusedLocals` clean). TS test files updated: `mandate.test.ts` → binding only; dc `mandate.test.ts` → `extractDcEvidence`; dc `verify.test.ts` → evidence; dc `routes.test.ts` → mocks `ap2Client` and asserts the seam (`amountBound=true`) + persistence. **Plus a no-mock live smoke**: compiled `ap2Client.js` → running sidecar → build+verify, all 7 passkey gates pass.

---

### Task 5: Run + deploy wiring

**Files:** `main.ts`, `package.json`, `vercel.json`, `api/ap2/index.py`, plus new `payment-gate/ap2Sidecar.ts`, `requirements.txt`.

- [x] **Step 1: Local/stdio.** New `payment-gate/ap2Sidecar.ts::startAp2Sidecar()` — best-effort `spawn` of `<python> -m uvicorn app:app --port $AP2_SIDECAR_PORT` (default 8787), resolving `ap2-sidecar/` from source/compiled/cwd and preferring `.venv/bin/python`. Never throws; registers SIGINT/SIGTERM/exit cleanup. Called from **both** `main.ts` entrypoints. **Deviation:** used an in-process spawn for `start:http` too (instead of `concurrently`) — no new dependency, single lifecycle. Added `start:sidecar` to run it standalone; `AP2_SIDECAR_SPAWN=0` opts out. **Verified live:** `node dist/main.js` spawned the sidecar (venv python), `/healthz` responded, and killing the parent cleaned up the child.
- [x] **Step 2: Vercel.** `api/ap2/index.py` puts `ap2-sidecar/` on `sys.path` and re-exports the ASGI `app`; `vercel.json` registers it as a Python function (`includeFiles: ap2-sidecar/**`) and adds a `/ap2/(.*) → /api/ap2` rewrite **before** the catch-all. Root `requirements.txt` pins the Task 0 dep set (uvicorn omitted; Vercel serves ASGI directly). `ap2Client` resolves the base URL to the **same deployment origin** on Vercel (`VERCEL` + `VERCEL_PROJECT_PRODUCTION_URL`/`PUBLIC_BASE_URL`), so it calls `${origin}/ap2/payment-mandate` → rewrite → Python function. **Verified locally:** the function module imports and exposes `/ap2/payment-mandate[/verify]`. **Unverified until first deploy** (per Task 0): that Vercel passes the original `/ap2/*` path through the rewrite to the ASGI app, and that the hybrid Node+Python build provisions both functions. Fallback documented: set `AP2_SIDECAR_URL` to an external service.
- [x] **Step 3: Env.** `AP2_ISSUER_JWK` (signing key; dev fallback) and `AP2_SIDECAR_URL` (override; else Vercel-origin or `localhost:8787`) documented in `ap2-sidecar/README.md` + `ap2Client.ts`/`ap2Sidecar.ts` comments. Also `AP2_SIDECAR_PORT`, `AP2_SIDECAR_PYTHON`, `AP2_SIDECAR_SPAWN`. **CSP: no change** — the sidecar is called **server-to-server** (Node route → sidecar `fetch`), never from the browser, so `connectDomains`/`connect_domains` are irrelevant to it. (Task 6 will note this in the docs.)

---

### Task 6: Tests + docs

**Files:** a TS↔sidecar contract test; `payment-gate/README.md`, `payment-gate/dc-payment/README.md`, `CLAUDE.md`, `ROADMAP.md`.

- [x] **Step 1:** `payment-gate/ap2Client.contract.test.ts` — spawns the **real** sidecar (venv) and drives `ap2Client` over HTTP (no mocks): passkey + dc build→verify all-pass, minor-units check (44900), and a tampered-amount rejection. `describe.skipIf` when the venv is absent (mirrors `verify.fixture.test.ts`). **Green: 3 passed live.**
- [x] **Step 2:** Rewrote the gate narratives: `payment-gate/README.md` "The four gates" → "Mandate authorization & gates (AP2 SD-JWT)" (real SDK signature + the evidence claims, `MOCK-DEV-SIGNER` gone); `dc-payment/README.md` "what binds the amount"/"real vs mocked"/"Files" now describe `extractDcEvidence` + the `amount_signature_bound` gate + the sidecar.
- [x] **Step 3:** `CLAUDE.md` — entrypoints (Node + Python functions; sidecar spawn), the payment-gate section (SD-JWT via sidecar, evidence boundary, `amount_signature_bound`), env vars (`AP2_ISSUER_JWK`/`AP2_SIDECAR_URL`/…). Also fixed the now-false **"single Vercel function"** lines in the top-level `README.md` (Deploy + Project layout) and added a `ROADMAP.md` entry (with the two open follow-ups). **Final: `npm run build` clean, TS 102 passed / 1 skipped, Python 21 passed.**

---

## Risks / open questions

1. **"Use the SDK" ≠ "SDK verifies the passkey."** It verifies the SD-JWT envelope; the WebAuthn/mdoc proof is a claim inside it. Confirm this matches the requester's intent.
2. **Two runtimes.** The clean single-function Vercel deploy becomes Node + Python. Operational change; documented in Task 5.
3. **SDK maturity.** Google reference code, likely not a versioned PyPI release — pin a commit, vendor if needed, expect to read source.
4. **Cold-start latency** on the Python verify hop in serverless.
5. **Delegation chain depth** (Task 2 Step 3) — start with a single PaymentMandate; full intent→cart→payment chain is a follow-up.
