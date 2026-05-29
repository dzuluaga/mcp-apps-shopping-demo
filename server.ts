import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { CATALOG, CATALOG_META_KEY, createOrder, priceCart, type Order } from "./catalog.js";

// Resolve the bundled UI relative to this module, working from both
// source (server.ts) and compiled (dist/server.js).
const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;

const RESOURCE_URI = "ui://product-picker/mcp-app.html";

// In-memory order store. Module-scoped (not inside createServer) so it survives
// the per-request server rebuild on the HTTP path (see main.ts). Orders are lost
// on restart and are not shared across separate processes (stdio vs http).
const orders = new Map<string, Order>();
let orderSeq = 1041;
function nextOrderId(): string {
  return `ORD-${++orderSeq}`;
}

// Shared input shape: a cart of { productId, quantity } entries.
const cartItemsSchema = {
  items: z.array(
    z.object({
      productId: z.string(),
      quantity: z.number().int(),
    }),
  ),
};

export function createServer(): McpServer {
  const server = new McpServer({
    name: "Product Picker MCP App",
    version: "1.0.0",
  });

  // Tool linked to the UI resource. Returns the catalog in its result so the
  // UI can render on a single round-trip.
  registerAppTool(
    server,
    "browse-products",
    {
      title: "Browse Products",
      description:
        "Open an interactive product picker. Shows a grid of products the user can multi-select.",
      inputSchema: {},
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async (): Promise<CallToolResult> => {
      // The catalog rides in _meta (app-only, out-of-band) so the UI can render
      // without the model echoing the full list back as text. The model sees
      // only the short status line below.
      return {
        content: [
          {
            type: "text",
            text: `Opened the product picker with ${CATALOG.length} products. The user selects items there and confirms.`,
          },
        ],
        _meta: { [CATALOG_META_KEY]: { products: CATALOG } },
      };
    },
  );

  // UI-internal tool: recompute the cart total server-side on every change.
  // Hidden from the model (visibility "app") — it returns the priced cart as
  // JSON for the UI to render.
  registerAppTool(
    server,
    "price-cart",
    {
      title: "Price Cart",
      description: "Compute authoritative line items and total for the current cart.",
      inputSchema: cartItemsSchema,
      _meta: { ui: { resourceUri: RESOURCE_URI, visibility: ["app"] } },
    },
    async ({ items }): Promise<CallToolResult> => {
      const cart = priceCart(items);
      return { content: [{ type: "text", text: JSON.stringify(cart) }] };
    },
  );

  // User-placed order. App-only (visibility "app") so the model cannot place
  // orders itself — only the picker UI button can. Persists the order in the
  // module-level store and returns it as JSON for the UI to render.
  registerAppTool(
    server,
    "place-order",
    {
      title: "Place Order",
      description: "Place the user's selected cart as an order. Triggered by the UI only.",
      inputSchema: cartItemsSchema,
      _meta: { ui: { resourceUri: RESOURCE_URI, visibility: ["app"] } },
    },
    async ({ items }): Promise<CallToolResult> => {
      const order = createOrder(items, nextOrderId());
      orders.set(order.id, order);
      return { content: [{ type: "text", text: JSON.stringify(order) }] };
    },
  );

  // The UI resource: bundled single-file HTML.
  registerAppResource(
    server,
    RESOURCE_URI,
    RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "mcp-app.html"), "utf-8");
      return {
        contents: [
          {
            uri: RESOURCE_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
            // The UI renders in a sandboxed iframe with a strict CSP; product
            // images load from picsum.photos, which redirects to fastly.
            // Both hosts must be allowlisted or images are blocked.
            _meta: {
              ui: {
                csp: {
                  resourceDomains: [
                    "https://picsum.photos",
                    "https://fastly.picsum.photos",
                  ],
                },
              },
            },
          },
        ],
      };
    },
  );

  return server;
}
