# Product Picker MCP App

<table>
<tr>
<td align="center" width="33%">
<a href="https://youtube.com/shorts/JA91c2d2DhQ">
<img src="https://img.youtube.com/vi/JA91c2d2DhQ/hqdefault.jpg" width="280" alt="Demo: Product Picker in the Claude native app"><br>
▶︎ Claude native app
</a>
</td>
<td align="center" width="33%">
<a href="https://youtube.com/shorts/8rMx5P1AOgI">
<img src="https://img.youtube.com/vi/8rMx5P1AOgI/hqdefault.jpg" width="280" alt="Demo: Product Picker in ChatGPT"><br>
▶︎ ChatGPT
</a>
</td>
<td align="center" width="33%">
<a href="https://youtu.be/MDlyOMIAgYg">
<img src="https://img.youtube.com/vi/MDlyOMIAgYg/hqdefault.jpg" width="280" alt="Demo: Product Picker in Claude desktop (claude.ai)"><br>
▶︎ Claude desktop (claude.ai)
</a>
</td>
</tr>
<tr>
<td align="center" width="33%">
<a href="https://youtu.be/qAXgxuihbA8">
<img src="https://img.youtube.com/vi/qAXgxuihbA8/hqdefault.jpg" width="280" alt="Demo: Utopia Marketplace in Goose, with passkey payment authorization"><br>
▶︎ Goose + passkey checkout
</a>
</td>
<td align="center" width="33%">
<a href="https://youtu.be/5MXRkNJF824">
<img src="https://img.youtube.com/vi/5MXRkNJF824/hqdefault.jpg" width="280" alt="Demo: Product Picker in Claude Code (terminal), with passkey payment authorization"><br>
▶︎ Claude Code + passkey checkout
</a>
</td>
<td align="center" width="33%">
<a href="https://youtu.be/GmYu-4M5unY">
<img src="https://img.youtube.com/vi/GmYu-4M5unY/hqdefault.jpg" width="280" alt="Demo: Product Picker in Claude Code (terminal), with Digital Payment Credentials and AP2 checkout"><br>
▶︎ Claude Code + AP2 checkout
</a>
</td>
</tr>
<tr>
<td align="center" width="33%">
<a href="https://youtu.be/5x47CO54wvI">
<img src="https://img.youtube.com/vi/5x47CO54wvI/hqdefault.jpg" width="280" alt="Which AI assistants let you add custom connectors: Claude and ChatGPT vs Copilot and Gemini"><br>
▶︎ Custom connectors: Claude & ChatGPT vs Copilot & Gemini
</a>
</td>
</tr>
</table>

An **agentic** shopping app built as **one MCP server that runs on every
surface** — the Claude native app, Claude on the web (claude.ai), Claude
Desktop, ChatGPT, Goose, and even Claude Code in the terminal. One server, one
UI bundle: each host renders the same widget natively (or, in a no-GUI host like
Claude Code, drives the whole flow from chat). The embedded UI is deliberately
small — it's just the visual part that benefits from being a widget: browse the
product grid and adjust quantities right on each card. Everything else
(confirming, asking about products, checkout) is driven by **the agent in
chat**, not by the iframe.

This mirrors how real Claude/Gemini commerce connectors work: the agent builds
and edits the cart conversationally but **does not place orders or take
payment**. Checkout is a hand-off to an external (mock) merchant page where you
complete the purchase with your own account.

**Claude CAN** browse and search the catalog, show product details and reviews,
read the cart, add items, change quantities, and remove items.
**Claude CANNOT** place orders or take payment — that happens on the merchant
page.

### The flow

1. **Select** — open the picker and add products with the per-card stepper. Each
   card reflects the quantity already in your cart; tapping − down to zero (shown
   as a 🗑) removes the item. Edits update the shared cart immediately.
2. **Claude confirms** — after you adjust the cart, Claude acknowledges the
   change, shows the cart total, and asks whether you want to add more or check
   out.
3. **Edit by talking** — ask to add/remove items ("drop the webcam", "make it
   two keyboards"), inspect the cart ("what's in my cart?"), or ask about
   products ("what do people say about the monitor?"). Claude uses tools to
   adjust the shared cart and answer.
4. **Checkout hand-off** — click **Checkout** in the widget (or ask the agent to
   check out). The agent calls the `checkout` tool, which snapshots the cart into
   an order and returns a link to the mock merchant page — it never places the
   order or takes payment itself. The page opens in your browser, where
   **Authorize payment** runs a real authorization ceremony. Two variants are
   demoed: a **passkey** (WebAuthn / Touch ID) user-presence proof, and a
   cross-device **Digital Payment Credentials / AP2** flow where your phone's
   wallet signs the exact cart total via OpenID4VP (carried phone↔desktop over
   FIDO caBLE) to produce an AP2 Payment Mandate — see
   [`payment-gate/README.md`](payment-gate/README.md). Nothing is charged.

The UI and the agent share one server-side cart, so anything Claude changes is
reflected in the picker's cart badge, and anything you add in the picker shows
up in chat. The cart is kept in-memory locally (lost on server restart); orders
carry no server state — they're encoded into the checkout link. The checkout
page is a mock (no real charge), but the **Authorize payment** step on it is a
real ceremony — passkey user-presence (see
[`payment-gate/README.md`](payment-gate/README.md)), or the cross-device,
amount-bound Digital Payment Credentials / AP2 variant where the wallet signs
over the exact cart total via OpenID4VP, carried phone↔desktop over FIDO caBLE
(see [`payment-gate/dc-payment/`](payment-gate/dc-payment/README.md)).

### Age verification & loyalty discount

Some products are age-restricted (alcohol). Age verification and the optional
loyalty discount happen on the **checkout page** (the link the `checkout` tool
returns), at the end of the flow:

- If the order contains an age-restricted item, **payment is locked** and a
  **Verify age** button requests a digital ID (`age_over_21`) via OpenID4VP —
  with an instant-demo fallback when no wallet/Chrome 141+ is available. The
  threshold is per product (`minimumAge`), and the check fails closed (requires
  an explicit positive claim).
- **Apply loyalty discount** presents a loyalty credential (validated
  `membership_number`) for 10% off the whole cart.

Verification is **scoped per order** (`product-picker:verification:<orderId>`),
so on the shared deployment one shopper's verification never affects another's
checkout. It's cleared when the purchase completes.

## Demo

See it running end to end (browse → edit cart → checkout with Digital Payment
Credentials → AP2 Payment Mandate):

- **Claude native app:** <https://youtube.com/shorts/JA91c2d2DhQ>
- **ChatGPT:** <https://youtube.com/shorts/8rMx5P1AOgI>
- **Claude desktop (claude.ai):** <https://youtu.be/MDlyOMIAgYg>
- **Goose — passkey checkout:** <https://youtu.be/qAXgxuihbA8>
- **Claude Code (terminal) — passkey checkout:** <https://youtu.be/5MXRkNJF824>
- **Claude Code (terminal) — Digital Payment Credentials + AP2:** <https://youtu.be/GmYu-4M5unY>
- **Custom connectors compared (Claude & ChatGPT vs Copilot & Gemini):** <https://youtu.be/5x47CO54wvI>

## Try the hosted demo

A live instance is already deployed, so you can add it as a custom connector and
try it **without building or deploying anything**.

**Connector URL:** `https://mcp-apps-nine.vercel.app/mcp`

1. **Claude** (web or desktop): Settings → **Connectors** → **Add custom
   connector**, paste the URL above, and save. Then ask *"Show me the product
   picker."* The grid renders inline; add items and adjust quantities on the
   cards, then click **Checkout** (or ask Claude) to open the mock merchant page.
2. **ChatGPT**: enable **developer mode**, then add a custom connector/app using
   the same URL.
3. **Claude Code (terminal)**: add it as a streamable-HTTP server, then shop and
   check out without leaving the terminal:

   ```bash
   claude mcp add --transport http product-picker https://mcp-apps-nine.vercel.app/mcp
   ```
4. **Goose** (or any other MCP host): add it as a streamable-HTTP/remote MCP
   server pointed at the same `/mcp` URL.

Just want to see the UI? Open the standalone browser preview — no host required:
<https://mcp-apps-nine.vercel.app/mcp-app.html> (loads the sample catalog
locally; checkout is agent-driven and only works inside an MCP host).

> This is an **authless** demo connector — fine for trying it out, not for
> production. The cart is demo-global (shared by everyone hitting the same
> deployment) and resets on redeploys; orders are stateless and the checkout
> page is a mock (no real charge).

## Build

```bash
npm install
npm run build
```

This bundles the React UI into a single `dist/mcp-app.html` and compiles the
server to `dist/`.

## Use in Claude Desktop

Add to `claude_desktop_config.json`
(`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS),
replacing the path with the absolute path to this project:

```json
{
  "mcpServers": {
    "product-picker": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/mcp-apps/dist/main.js", "--stdio"]
    }
  }
}
```

Restart Claude Desktop. Then ask: "Show me the product picker." Claude calls
`browse-products`, the grid renders inline, you pick items and click "Add to
cart", and Claude takes over in chat to confirm and edit the cart. When you're
ready, click **Checkout** (or ask Claude) to open the mock merchant page in your
browser and finish there.

The mock checkout page is served over HTTP on port `3030` (override with
`CHECKOUT_PORT`). In stdio mode this listener starts in the same process so it
shares the cart/order state.

Product images load from picsum.photos (allowlisted via the resource CSP); if a
host blocks them, each card falls back to an inline SVG placeholder.

## Use as a remote connector (Claude + ChatGPT)

The same server runs over HTTPS as a remote/custom connector that **both Claude
and ChatGPT** can add. One origin serves everything: the MCP endpoint at `/mcp`
and the mock checkout page at `/checkout`. The single UI bundle is registered
twice — once with the MCP Apps mime (`text/html;profile=mcp-app`) for Claude and
once with the skybridge mime (`text/html+skybridge`) for ChatGPT — and detects
its host at runtime (`window.openai` → ChatGPT, top-level/`?standalone` →
standalone, otherwise an MCP host).

1. **Build and run in HTTP mode** (no `--stdio` flag):

   ```bash
   npm run build
   PORT=3001 node dist/main.js
   ```

2. **Expose it over HTTPS.** Both hosts require an `https://` URL, so tunnel the
   local port (e.g. with ngrok):

   ```bash
   ngrok http 3001
   ```

3. **Point the server at its public origin** so the checkout link resolves from
   the user's browser instead of localhost. Restart with the tunnel URL:

   ```bash
   PORT=3001 \
   PUBLIC_BASE_URL="https://YOUR-TUNNEL.ngrok.app" \
   ALLOWED_HOSTS="YOUR-TUNNEL.ngrok.app" \
   node dist/main.js
   ```

   - `PUBLIC_BASE_URL` is the externally reachable origin both `/mcp` and the
     checkout link point at. Without it the `checkout` tool returns a
     `localhost` URL that won't open for a remote user.
   - `ALLOWED_HOSTS` (comma-separated) enables the transport's DNS-rebinding
     guard for the tunnel host. Omit it for a quick local test.

4. **Add the connector in each host**, using the tunnel's `/mcp` URL
   (`https://YOUR-TUNNEL.ngrok.app/mcp`):
   - **Claude:** Settings → Connectors → add a custom connector.
   - **ChatGPT:** enable developer mode, then add it as a custom connector/app.

This is an **authless** demo connector — fine for a demo, not for production.
The cart is in-memory and shared across both hosts hitting the same server (it
resets on restart); orders are stateless, encoded into the checkout link.

> **Note:** the ChatGPT side uses a `window.openai` bridge whose exact surface is
> still evolving. All ChatGPT-specific calls are optional-chained, but the widget
> behavior should be **verified live in ChatGPT developer mode** — it has not been
> exhaustively confirmed against the current Apps SDK.

## Deploy to Vercel

The server also runs on Vercel as a single serverless function, which gives you
a stable HTTPS origin without running a tunnel. `api/index.ts` exports the same
Express app (`createApp()`), and `vercel.json` rewrites every path to it, so one
function serves both `/mcp` and `/checkout`.

Serverless functions don't keep module memory between invocations, so the two
pieces of shared state are handled differently:

- **Cart** — persisted through a `CartStore`. Locally (and in stdio mode) it's an
  in-memory store with zero dependencies; on Vercel it uses Upstash Redis when
  the connection env vars are present. Without Redis the cart would appear to
  reset between requests, so Redis is required for the deployed app to behave.
- **Orders** — stateless. The `checkout` tool encodes the order into the checkout
  URL (base64url), so the merchant page reconstructs it from the link with no
  store at all.

1. **Provision Upstash Redis.** From the project directory:

   ```bash
   vercel install upstash
   ```

   This adds the Upstash integration and auto-syncs the connection env vars
   (`KV_REST_API_URL` / `KV_REST_API_TOKEN`, or the `UPSTASH_REDIS_REST_URL` /
   `UPSTASH_REDIS_REST_TOKEN` pair) into the project. `selectCartStore` picks the
   Redis store automatically when it sees them.

2. **Deploy:**

   ```bash
   vercel deploy --prod
   ```

   Vercel runs `npm run build` (per `vercel.json`), which bundles the UI into
   `dist/mcp-app.html` and compiles the server. The UI bundle is shipped with the
   function via `includeFiles: dist/**`.

3. **No `PUBLIC_BASE_URL` needed.** The checkout link falls back to
   `VERCEL_PROJECT_PRODUCTION_URL`, which Vercel injects automatically, so the
   link points at the deployment's own origin. Set `PUBLIC_BASE_URL` only if you
   want to override it (e.g. a custom domain). `ALLOWED_HOSTS` is optional and
   off by default.

4. **Add the connector** in Claude (or ChatGPT) using the deployment's `/mcp`
   URL — `https://YOUR-PROJECT.vercel.app/mcp`.

Like the tunnel setup, this is an **authless** demo connector. The cart lives in
Redis and is demo-global (shared across everyone hitting the deployment); orders
carry no server state.

## Preview in the browser

The UI normally talks to the MCP host over a `postMessage` bridge. When opened
directly in a browser it detects there is no host and runs in **standalone
mode**: it loads the sample catalog locally, and "Add to cart" accumulates a
local cart shown in the footer badge. Checkout is agent-driven and only works
inside an MCP host, so standalone mode is for iterating on the selection UI
itself — no Claude Desktop required.

```bash
npm run dev   # opens http://localhost:5173/mcp-app.html
```

Standalone mode triggers automatically outside an iframe; append `?standalone`
to force it.

## Develop / inspect

```bash
npm test                                                        # unit tests
npx @modelcontextprotocol/inspector node dist/main.js --stdio   # inspect tools/resources
```

## Project layout

- `server.ts` — MCP server + shared cart (read/written through `cartStore`).
  Tools: `browse-products` (opens the UI), `add-to-cart` / `set-quantity` /
  `remove-from-cart` / `get-cart` / `checkout` (model- and UI-callable, linked to
  the UI so chat-driven edits route back to the open picker),
  `get-product-details` / `get-product-reviews` (model-only info). `checkout`
  snapshots the cart into an order and returns `{ orderId, checkoutUrl }`; it does
  not place the order or take payment. The UI bundle is registered as two
  resources — the MCP Apps mime for Claude and a `text/html+skybridge` resource
  for ChatGPT — and tools carry both `ui.resourceUri` and `openai/outputTemplate`
  meta plus tool `annotations`.
- `cartStore.ts` — `CartStore` abstraction for the shared cart. `MemoryCartStore`
  (in-process, zero deps) for local/stdio use; `RedisCartStore` (Upstash) for
  serverless. `selectCartStore` picks Redis when the connection env vars are set,
  else memory.
- `checkout.ts` — stateless orders + the mock checkout HTML page and its HTTP
  listener (`startCheckoutHttpServer`, default port `3030`). `createCheckoutOrder`
  encodes the order into the checkout URL (base64url, via `encodeOrder`);
  `checkoutResponse` decodes it (`decodeOrder`) to render the page — no order
  store. Used by both the standalone listener and the `/checkout` route.
- `app.ts` — `createApp()` builds the Express app serving `/mcp` and `/checkout`
  from one origin (no `listen()`), reused by both `main.ts` and the Vercel
  function.
- `main.ts` — stdio (Claude Desktop) and HTTP entrypoints; calls `createApp()`
  and listens locally, and starts the checkout listener in stdio mode
- `api/index.ts` / `vercel.json` — Vercel serverless entrypoint (`export default
  createApp()`) and config that rewrites all paths to the one function
- `catalog.ts` — sample products + reviews + `priceCart` / `createOrder` /
  `getProduct` / `getReviews` helpers
- `src/app.tsx` — React selection UI with a footer Checkout button; one bundle
  with runtime host detection for three modes: MCP host (Claude), ChatGPT
  (`window.openai` bridge), and standalone browser preview
- `mcp-app.html` / `vite.config.ts` — single-file UI bundle
