# Product Picker MCP App

An MCP App for Claude Desktop that shows an interactive product picker in the
chat. Browse a grid of products, add items with quantity steppers, and the cart
total is recomputed server-side on every change. Confirming sends the priced
cart back into the conversation so Claude can act on it.

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
`browse-products`, the grid renders inline, you adjust quantities, and
confirming adds the priced cart to the conversation.

Product images load from picsum.photos (allowlisted via the resource CSP); if a
host blocks them, each card falls back to an inline SVG placeholder.

## Preview in the browser

The UI normally talks to the MCP host over a `postMessage` bridge. When opened
directly in a browser it detects there is no host and runs in **standalone
mode**: it loads the sample catalog locally and shows the selection in an alert
instead of sending it to a chat. This is the fast way to iterate on the UI
without Claude Desktop.

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

- `server.ts` — MCP server: UI resource + `browse-products`, `price-cart`
  (UI-only, recomputes the total), `confirm-selection`
- `main.ts` — stdio (Claude Desktop) and HTTP entrypoints
- `catalog.ts` — sample products + `priceCart` helper
- `src/app.tsx` — React cart UI (host + standalone modes)
- `mcp-app.html` / `vite.config.ts` — single-file UI bundle
