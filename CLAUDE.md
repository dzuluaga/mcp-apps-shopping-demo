# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

One MCP server that runs as an agentic shopping connector on every surface —
Claude native app, claude.ai web, Claude Desktop, ChatGPT, Goose, and Claude
Code (terminal). A single React UI bundle is rendered as a widget by GUI hosts
and ignored by no-GUI hosts (the flow runs entirely from chat there). The
embedded widget is deliberately minimal — just a product grid with per-card
quantity steppers. Everything else (confirming, Q&A, checkout) is **agent-driven
in chat**, mirroring real commerce connectors: the agent edits the cart but
**never places orders or takes payment**. Checkout is a hand-off to a mock
merchant page.

## Commands

```bash
npm run build      # typecheck + bundle UI (dist/mcp-app.html) + compile server (dist/)
npm run typecheck  # tsc --noEmit against tsconfig.json (the strict UI/source config)
npm test           # vitest run (all *.test.ts)
npx vitest run catalog.test.ts            # single test file
npx vitest run -t "name of test"          # single test by name
npm run dev        # vite dev server at http://localhost:5173/mcp-app.html (standalone UI preview)

npm run start:stdio   # node dist/main.js --stdio  (Claude Desktop)
npm run start:http    # node dist/main.js          (remote/HTTP connector, PORT defaults 3001)
npx @modelcontextprotocol/inspector node dist/main.js --stdio   # inspect tools/resources
```

There is no linter; correctness is enforced by `tsc` (strict, `noUnusedLocals`,
`noUnusedParameters`) and vitest. Run `npm run build` (or at least
`npm run typecheck` + `npm test`) before considering a change done. Note the
build uses **two** tsconfigs: `tsconfig.json` (noEmit, includes `src/` UI +
DOM libs, used by `typecheck`) and `tsconfig.server.json` (emits `dist/`,
NodeNext, server files only).

## Architecture

The whole app is one Express app (`createApp()` in `app.ts`, no `listen()`)
serving everything from one origin: `/mcp` (the MCP endpoint), `/checkout` (mock
merchant page), and the payment-gate routes. Three entrypoints reuse it:

- `main.ts` — stdio (Claude Desktop) and HTTP (`node dist/main.js [--stdio]`).
  In stdio mode it also starts the checkout HTTP listener (`checkout.ts`,
  default port 3030) in-process so it shares cart/order state. Both modes also
  spawn the **AP2 sidecar** (`payment-gate/ap2Sidecar.ts` → `ap2-sidecar/`,
  default port 8787); disable with `AP2_SIDECAR_SPAWN=0`.
- `api/index.ts` + `vercel.json` — Vercel: the Node function (`api/index.ts`)
  serves `/mcp` + `/checkout` + payment-gate routes; a **second, Python** function
  (`api/ap2/index.py`) serves the AP2 sidecar. `vercel.json` rewrites `/ap2/*` to
  the Python function and everything else to the Node one. (No longer a single
  function — the AP2 SDK is Python-only; see the payment-gate note below.)

`server.ts` builds the `McpServer` via `createServer()`. **A fresh server +
transport is created per `/mcp` request** (see `app.ts`), so server-side state
must NOT live in module memory on the serverless path — it goes through the
stores below.

### The shared cart is the core invariant

The picker UI and the chat agent mutate **one server-side cart** (productId →
quantity), so an edit from either side is visible to the other. Every mutation
is read → mutate → write through `cartStore` so concurrent serverless instances
converge. The cart is **demo-global** (not per-conversation) and lossy on
restart.

- `cartStore.ts` / `orderStore.ts` — `CartStore` / `OrderStore` abstractions.
  `Memory*` (in-process, zero deps) locally/stdio; `Redis*` (Upstash) on Vercel.
  `selectCartStore`/`selectOrderStore` pick Redis when the connection env vars
  (`KV_REST_API_URL`/`KV_REST_API_TOKEN` or `UPSTASH_REDIS_REST_*`) are present,
  else memory. Redis is **required** for the deployed app to behave (module
  memory doesn't persist between serverless invocations).

### Orders are stateless

`checkout.ts` encodes the order into the checkout URL as a base64url token
(`encodeOrder`/`decodeOrder`) — the merchant page and payment gates reconstruct
the order from the link, with no order store. The only *post-purchase* state is
the `CompletedOrder` in `orderStore` (written by a payment gate on success). MCP
has no server→client push, so completion flows back to chat by polling:
`get-order-status` (agent) and `/checkout/order-status` (the widget, which then
injects a user-turn message so the agent confirms in chat).

### Dual-host UI registration

The single bundle is registered as **two resources** so one server works in both
host families: the MCP Apps mime (`RESOURCE_MIME_TYPE`, for Claude, read via
`_meta.ui.resourceUri`) and `text/html+skybridge` (for ChatGPT, read via
`_meta["openai/outputTemplate"]`). UI-linked tools carry **both** pointers
(`UI_META`). `src/app.tsx` detects its host at runtime: `window.openai` →
ChatGPT, top-level / `?standalone` → standalone browser preview, else an MCP
host over a `postMessage` bridge. The resource URI is stamped with an 8-char
hash of the bundle (`BUNDLE_VERSION`) so hosts that cache by URI (Claude
Desktop) re-fetch after a redeploy.

CSP matters: `resourceDomains`/`resource_domains` allowlist picsum image hosts;
`connectDomains`/`connect_domains` must include the checkout origin or the
widget's order-status poll is blocked and completion never reaches chat.

### MCP tools (`server.ts`)

UI-linked (`registerAppTool`, carry `UI_META`): `browse-products` (opens the
picker), `add-to-cart`, `set-quantity`, `remove-from-cart`, `get-cart`,
`checkout`. Model-only (`server.registerTool`, no widget): `get-product-details`,
`get-product-reviews`, `get-order-status`. `browse-products`' text response
encodes the agent's capability contract and flow — keep it in sync with actual
tool behavior. Cart-returning tools emit the payload three ways
(`structuredContent` + JSON text block + `_meta`) so either host can read it.
`checkout` accepts the widget's on-screen `items` (authoritative over the shared
cart) and never clears the cart.

### Payment gate (`payment-gate/`)

Replaces the mock "Place order" with a real cryptographic authorization ceremony
over the exact cart total (nothing is charged). Reached only from `/checkout`,
reads the order solely from the URL token, adds **no storage** (challenges ride
in `GATE_SECRET`-signed HMAC tokens, `challengeToken.ts`). Two variants, each
registered onto the Express app:

- `passkey/` — WebAuthn user-presence proof (Touch ID / Windows Hello /
  cross-device). Amount-binding is a consistency check, not a signature.
- `dc-payment/` — cross-device Digital Payment Credentials / AP2: the phone
  wallet **signs over the exact amount** via OpenID4VP (carried phone↔desktop
  over FIDO caBLE).

The mandate is a **real ES256 SD-JWT PaymentMandate** produced + validated by the
**AP2 sidecar** (`ap2-sidecar/`, a Python service wrapping the official AP2 SDK,
which is Python-only and vendored under `ap2-sidecar/vendor/ap2`). The TS routes
verify the device ceremony (`@simplewebauthn`, mdoc/JWE) and pass the evidence to
the sidecar over HTTP via `payment-gate/ap2Client.ts`; the sidecar mints the
SD-JWT and runs the gates (signature/amount/payee/subject + device-evidence
claims), returning `{gate,pass,detail}[]`. The DC wallet-signature amount-binding
is computed in TS (the sidecar never sees the vp_token) and attested as the
`amount_signature_bound` gate. `AP2_SIDECAR_URL` selects the sidecar (Vercel
same-origin `/ap2/*`, else `localhost:8787`); `AP2_ISSUER_JWK` signs mandates. See
`ap2-sidecar/README.md`, `payment-gate/README.md`,
`payment-gate/dc-payment/README.md`, and the plan
`docs/superpowers/plans/2026-06-05-ap2-python-sdk-sidecar.md`.

## Key env vars

- `PUBLIC_BASE_URL` — externally reachable origin for `/mcp` and the checkout
  link. Without it the checkout link points at `localhost`. On Vercel it falls
  back to `VERCEL_PROJECT_PRODUCTION_URL` (auto-injected).
- `ALLOWED_HOSTS` (comma-separated) — enables the transport's DNS-rebinding
  guard; off by default.
- `PORT` (HTTP, default 3001), `CHECKOUT_PORT` (stdio checkout listener, 3030).
- `GATE_SECRET` — signs payment-gate challenge tokens; dev falls back to a
  per-process random value.
- `AP2_ISSUER_JWK` — ES256/P-256 JWK the AP2 sidecar signs mandates with; dev
  falls back to a per-process key (won't verify across instances). `AP2_SIDECAR_URL`
  overrides the sidecar location; `AP2_SIDECAR_PORT`/`_PYTHON`/`_SPAWN` tune the
  local child process.
- Upstash: `KV_REST_API_URL`/`KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_*`).

## Gotchas

- This is an **authless demo** — fine for trying it out, not production. The cart
  is shared by everyone hitting a deployment.
- The ChatGPT `window.openai` bridge is evolving; all ChatGPT-specific calls are
  optional-chained and should be **verified live in ChatGPT developer mode**.
- Product images come from picsum.photos (redirects to fastly); both hosts must
  stay allowlisted in the CSP or cards fall back to an inline SVG placeholder.
