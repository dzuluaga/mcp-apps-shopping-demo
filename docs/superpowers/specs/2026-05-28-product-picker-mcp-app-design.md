# Product Picker MCP App — Design

**Date:** 2026-05-28
**Status:** Approved (design)

## Goal

Build a local MCP App for Claude Desktop that renders a rich, interactive
multi-product selector inside the chat. The user browses a grid of product
cards, selects multiple items, confirms, and the selection flows back into the
conversation so Claude can act on it.

## Decisions

- **Runtime:** Claude Desktop, local stdio transport.
- **Data source:** hardcoded sample catalog (extensible later).
- **Stack:** TypeScript / Node, React UI.
- **UI delivery:** MCP Apps extension (`@modelcontextprotocol/ext-apps`),
  bundled to a single HTML resource with Vite + `vite-plugin-singlefile`.
- **Build:** Vite (UI) + `tsc` (server). No `bun` dependency, unlike the
  upstream example.

## Architecture

```
mcp-apps/
  server.ts            McpServer: registers UI resource + tools
  main.ts              entrypoint: --stdio (local) and HTTP (future use)
  catalog.ts           sample product data
  mcp-app.html         UI shell loaded as the ui:// resource
  src/app.tsx          React multi-select UI via useApp()
  src/app.module.css   product grid / card styling, light+dark aware
  src/global.css       base styles
  vite.config.ts       single-file UI bundle
  package.json
  tsconfig.json        UI typecheck
  tsconfig.server.json server emit
  README.md            install + claude_desktop_config.json snippet
```

### Server (`server.ts`)

A `createServer()` factory returning an `McpServer`. It registers:

1. **UI resource** `ui://product-picker/app.html` via `registerAppResource`,
   returning the bundled HTML with `mimeType: RESOURCE_MIME_TYPE`.
2. **Tool `browse-products`** via `registerAppTool`, linked to the resource
   through `_meta: { ui: { resourceUri } }`. Input schema is empty (optionally a
   `category` filter later). Its `CallToolResult` carries the sample catalog as
   JSON (a text content block) plus a short human-readable summary, so the UI
   can render on a single round-trip.
3. **Tool `confirm-selection`** — a plain server tool (no UI) the UI invokes via
   `callServerTool`. Input: `{ productIds: string[] }` validated with zod.
   Returns a tidy text summary (names, line prices, total). This gives Claude a
   clean, structured record of the final choice.

### UI (`src/app.tsx`)

React component using the `useApp()` hook from
`@modelcontextprotocol/ext-apps/react`:

- On `ontoolresult`, parse the catalog JSON and store it in state.
- Render a responsive grid of product cards (image, name, category, price,
  blurb) each with a checkbox / selectable state.
- Track selected ids in state; show a running count and total price in a footer
  bar.
- "Add selection to chat" button (disabled when nothing selected):
  1. calls `confirm-selection` via `app.callServerTool` with the selected ids;
  2. calls `app.sendMessage(...)` with a human-readable list so the selection
     appears in the conversation for Claude to continue from.
- Respect `hostContext.safeAreaInsets` for padding (as the upstream example
  does).
- Connecting / error states surfaced from `useApp()`.

### Sample catalog (`catalog.ts`)

~8 products. Each: `id`, `name`, `price` (number), `currency`, `image` (URL),
`category`, `description`. Shared by the server (returned in the tool result and
used by `confirm-selection` for pricing).

## Data flow

1. User asks Claude to browse products → Claude calls `browse-products`.
2. Host renders the `ui://product-picker/app.html` resource in a sandboxed
   iframe; the UI receives the tool result (catalog) via `ontoolresult`.
3. User selects products and clicks confirm.
4. UI calls `confirm-selection` (server prices it and returns a summary), then
   `sendMessage` injects the selection into the conversation.
5. Claude proceeds with the chosen products.

## Error handling

- `confirm-selection` validates `productIds` with zod; unknown ids are ignored
  with a note in the summary.
- UI disables confirm when the selection is empty.
- `useApp()` connecting/error states render a clear message instead of a blank
  screen.

## Build & run

- `npm run build`: `vite build` produces a single `dist/app.html`; `tsc -p
  tsconfig.server.json` (plus a JS emit step) produces `dist/index.js` and
  `dist/server.js`.
- Claude Desktop config runs `node <abs-path>/dist/index.js --stdio`.
- `server.ts` reads the bundled HTML relative to its compiled location, so it
  works from both source and `dist`.

## Testing

- `npm run build` must succeed (typecheck + bundle).
- Verify tool + resource registration with `@modelcontextprotocol/inspector`
  (lists `browse-products`, `confirm-selection`, and the `ui://` resource;
  resource read returns HTML).
- Manual smoke test in Claude Desktop: invoke the tool, confirm the grid
  renders, select multiple items, confirm, and verify the selection lands in the
  conversation.

## Out of scope (YAGNI)

- Real catalog / external API integration.
- Cart persistence, checkout, payments.
- HTTP/remote deployment (entrypoint supports it, but not a goal here).
- Auth.
```

## Open follow-ups

None blocking. Category filtering and remote deployment are natural future
extensions but intentionally excluded from this build.
