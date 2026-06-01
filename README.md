# Product Picker MCP App

An **agentic** shopping app for Claude Desktop. The embedded UI is deliberately
small — it's just the visual part that benefits from being a widget: browse the
product grid, pick quantities, and click **Add to cart**. Everything after that
is driven by **Claude in chat**, not by the iframe.

This mirrors how real Claude/Gemini commerce connectors work: the agent builds
and edits the cart conversationally but **does not place orders or take
payment**. Checkout is a hand-off to an external (mock) merchant page where you
complete the purchase with your own account.

**Claude CAN** browse and search the catalog, show product details and reviews,
read the cart, add items, change quantities, and remove items.
**Claude CANNOT** place orders or take payment — that happens on the merchant
page.

### The flow

1. **Select** — open the picker, choose products and quantities, click "Add to
   cart". The picker hands off to Claude.
2. **Claude confirms** — it acknowledges your picks, shows the cart total, and
   asks whether you want to add more or check out.
3. **Edit by talking** — ask to add/remove items ("drop the webcam", "make it
   two keyboards"), inspect the cart ("what's in my cart?"), or ask about
   products ("what do people say about the monitor?"). Claude uses tools to
   adjust the shared cart and answer.
4. **Checkout hand-off** — click **Checkout** in the widget (or ask Claude to
   check out). Claude calls the `checkout` tool, which snapshots the cart into
   an order and returns a link to the mock merchant page. The page opens in your
   browser; you complete the (simulated) purchase there.

The UI and the agent share one server-side cart, so anything Claude changes is
reflected in the picker's cart badge, and anything you add in the picker shows
up in chat. Orders and the cart are kept in-memory (lost on server restart); the
checkout page is a mock (no real charge).

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
Orders and the cart are in-memory and shared across both hosts hitting the same
server; they reset on restart.

> **Note:** the ChatGPT side uses a `window.openai` bridge whose exact surface is
> still evolving. All ChatGPT-specific calls are optional-chained, but the widget
> behavior should be **verified live in ChatGPT developer mode** — it has not been
> exhaustively confirmed against the current Apps SDK.

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

- `server.ts` — MCP server + shared server-side cart. Tools: `browse-products`
  (opens the UI), `add-to-cart` / `set-quantity` / `remove-from-cart` /
  `get-cart` / `checkout` (model- and UI-callable, linked to the UI so
  chat-driven edits route back to the open picker), `get-product-details` /
  `get-product-reviews` (model-only info). `checkout` snapshots the cart into an
  order and returns `{ orderId, checkoutUrl }`; it does not place the order or
  take payment. The UI bundle is registered as two resources — the MCP Apps mime
  for Claude and a `text/html+skybridge` resource for ChatGPT — and tools carry
  both `ui.resourceUri` and `openai/outputTemplate` meta plus tool `annotations`.
- `checkout.ts` — in-memory order store + the mock checkout HTML page and its
  HTTP listener (`startCheckoutHttpServer`, default port `3030`). Exposes
  `createCheckoutOrder` (used by the `checkout` tool) and `checkoutResponse`
  (used by both the standalone listener and the HTTP entrypoint's `/checkout`
  route).
- `main.ts` — stdio (Claude Desktop) and HTTP entrypoints; starts/mounts the
  checkout page in both modes
- `catalog.ts` — sample products + reviews + `priceCart` / `createOrder` /
  `getProduct` / `getReviews` helpers
- `src/app.tsx` — React selection UI with a footer Checkout button; one bundle
  with runtime host detection for three modes: MCP host (Claude), ChatGPT
  (`window.openai` bridge), and standalone browser preview
- `mcp-app.html` / `vite.config.ts` — single-file UI bundle
