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
import {
  CART_META_KEY,
  CATALOG,
  CATALOG_META_KEY,
  getProduct,
  getReviews,
  priceCart,
  type PricedCart,
} from "./catalog.js";
import { createCheckoutOrder } from "./checkout.js";

// Resolve the bundled UI relative to this module, working from both
// source (server.ts) and compiled (dist/server.js).
const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;

// The UI bundle is served twice from the same HTML so one server works in both
// hosts: MCP hosts (Claude) read RESOURCE_URI via _meta.ui.resourceUri; ChatGPT
// reads SKYBRIDGE_URI via _meta["openai/outputTemplate"] and needs the skybridge
// mime. The bundle detects the host at runtime (see src/app.tsx).
const RESOURCE_URI = "ui://product-picker/mcp-app.html";
const SKYBRIDGE_URI = "ui://product-picker/mcp-app.skybridge.html";
const SKYBRIDGE_MIME = "text/html+skybridge";

// Domains the iframe needs to load product images (picsum redirects to fastly).
const IMAGE_DOMAINS = ["https://picsum.photos", "https://fastly.picsum.photos"];

// Both hosts find the open widget from any UI-linked tool, so they all carry
// both resource pointers.
const UI_META = {
  ui: { resourceUri: RESOURCE_URI },
  "openai/outputTemplate": SKYBRIDGE_URI,
};

async function loadBundle(): Promise<string> {
  return fs.readFile(path.join(DIST_DIR, "mcp-app.html"), "utf-8");
}

// Cart-returning tools emit the same payload three ways so either host can read
// it: structuredContent (ChatGPT widget + model), a JSON text block (the model
// and the Claude UI's content parser), and _meta (the Claude UI's out-of-band
// channel).
function cartResult(priced: PricedCart): CallToolResult {
  return {
    structuredContent: priced as unknown as Record<string, unknown>,
    content: [{ type: "text", text: JSON.stringify(priced) }],
    _meta: { [CART_META_KEY]: priced },
  };
}

// Shared server-side cart (productId -> quantity). Single source of truth for
// both the UI and the model: the picker UI and the chat agent mutate the same
// cart through set-quantity, so edits from either side stay consistent.
// Module-scoped so it survives the per-request server rebuild on the HTTP path
// (see main.ts). Demo-global (not per-conversation) — fine for a single-user
// local app. The order store lives in checkout.ts.
const cart = new Map<string, number>();

function pricedCart(): PricedCart {
  const items = [...cart.entries()].map(([productId, quantity]) => ({ productId, quantity }));
  return priceCart(items);
}

function setQuantity(productId: string, quantity: number): PricedCart {
  if (quantity <= 0) cart.delete(productId);
  else cart.set(productId, quantity);
  return pricedCart();
}

// Adds quantities on top of what's already in the cart (the picker's
// "Add to cart" commits a batch; the agent can add items by id too).
function addToCart(items: { productId: string; quantity: number }[]): PricedCart {
  for (const { productId, quantity } of items) {
    if (quantity <= 0) continue;
    cart.set(productId, (cart.get(productId) ?? 0) + quantity);
  }
  return pricedCart();
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: "Product Picker MCP App",
    version: "1.0.0",
  });

  // Opens the picker. The picker is selection-only: the user browses and clicks
  // "Add to cart"; everything after that (confirming, adding more, checkout) is
  // driven by the agent in chat. The text below states the capability contract —
  // what the agent CAN and CANNOT do — and how to run the flow.
  registerAppTool(
    server,
    "browse-products",
    {
      title: "Browse Products",
      description:
        "Open an interactive product picker so the user can browse and select products to add to their cart.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: UI_META,
    },
    async (): Promise<CallToolResult> => {
      // The catalog + cart ride in structuredContent (ChatGPT) and _meta (Claude,
      // out-of-band) so the UI can render without the model echoing the full list
      // back as text. The model sees only the short status line below.
      const priced = pricedCart();
      return {
        content: [
          {
            type: "text",
            text:
              `Opened the product picker with ${CATALOG.length} products. The picker is selection-only — ` +
              `the user adds items there (or asks you to). You drive the rest in chat.\n` +
              `You CAN: browse and search the catalog, show product details and reviews, read the cart, ` +
              `add items, change quantities, and remove items.\n` +
              `You CANNOT: place orders or take payment — checkout happens on the merchant's page, where ` +
              `the user completes the purchase with their own account.\n` +
              `Flow:\n` +
              `1. When items are added, briefly confirm the cart and ask if they want to add more or check out.\n` +
              `2. Adjust the cart by id with add-to-cart, set-quantity, and remove-from-cart; read it with get-cart.\n` +
              `3. To check out, call checkout to get a checkout link and share it with the user — do not try to ` +
              `pay or confirm the order yourself.\n` +
              `Use get-product-details and get-product-reviews to answer questions about items.`,
          },
        ],
        structuredContent: { products: CATALOG, cart: priced },
        _meta: {
          [CATALOG_META_KEY]: { products: CATALOG },
          [CART_META_KEY]: priced,
        },
      };
    },
  );

  // Add a batch of items to the cart (additive). Used by the picker's
  // "Add to cart" button and by the agent ("add a webcam"). Model-visible AND
  // linked to the UI so chat-driven adds route back to the open picker.
  registerAppTool(
    server,
    "add-to-cart",
    {
      title: "Add to Cart",
      description:
        "Add one or more products to the cart by id. Quantities add on top of what's already there.",
      inputSchema: {
        items: z.array(
          z.object({ productId: z.string(), quantity: z.number().int().min(1) }),
        ),
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
      _meta: UI_META,
    },
    async ({ items }): Promise<CallToolResult> => {
      return cartResult(addToCart(items));
    },
  );

  // Set an absolute quantity for one product (0 removes). The agent uses this to
  // adjust or remove items conversationally. Model-visible + linked to the UI.
  registerAppTool(
    server,
    "set-quantity",
    {
      title: "Set Quantity",
      description:
        "Set the exact quantity of a product in the cart by id. Quantity 0 removes it. " +
        "Use this to change or remove an item on the user's behalf.",
      inputSchema: {
        productId: z.string(),
        quantity: z.number().int().min(0),
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
      _meta: UI_META,
    },
    async ({ productId, quantity }): Promise<CallToolResult> => {
      return cartResult(setQuantity(productId, quantity));
    },
  );

  // Remove a product from the cart by id. A clear-intent alias for set-quantity 0,
  // so "delete the webcam" maps to an obvious tool. Idempotent: removing an item
  // that isn't there just returns the unchanged cart. Linked to the UI.
  registerAppTool(
    server,
    "remove-from-cart",
    {
      title: "Remove from Cart",
      description:
        "Remove a product from the cart by id. Use this when the user asks to delete or drop an item.",
      inputSchema: { productId: z.string() },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
      _meta: UI_META,
    },
    async ({ productId }): Promise<CallToolResult> => {
      cart.delete(productId);
      return cartResult(pricedCart());
    },
  );

  // Read the current cart. Model-visible + linked so the agent can confirm what
  // the user selected, and the UI can seed itself.
  registerAppTool(
    server,
    "get-cart",
    {
      title: "Get Cart",
      description: "Return the current cart: line items, quantities, and total.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: UI_META,
    },
    async (): Promise<CallToolResult> => {
      return cartResult(pricedCart());
    },
  );

  // Informational, model-only (plain tool, not linked to the UI) so the agent
  // can tell the user about a product they picked without re-rendering the app.
  server.registerTool(
    "get-product-details",
    {
      title: "Get Product Details",
      description: "Return full details for a single product by id.",
      inputSchema: { productId: z.string() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ productId }): Promise<CallToolResult> => {
      const product = getProduct(productId);
      if (!product) {
        return {
          content: [{ type: "text", text: `No product found with id "${productId}".` }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(product) }] };
    },
  );

  // Sample reviews for a product. Model-only — answers "what do people say
  // about X?" in chat.
  server.registerTool(
    "get-product-reviews",
    {
      title: "Get Product Reviews",
      description: "Return customer reviews for a single product by id.",
      inputSchema: { productId: z.string() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ productId }): Promise<CallToolResult> => {
      const product = getProduct(productId);
      if (!product) {
        return {
          content: [{ type: "text", text: `No product found with id "${productId}".` }],
          isError: true,
        };
      }
      const reviews = getReviews(productId);
      return {
        content: [
          { type: "text", text: JSON.stringify({ productId, name: product.name, reviews }) },
        ],
      };
    },
  );

  // Hand off to checkout. Snapshots the current cart into an order and returns a
  // link to the (mock) merchant checkout page, where the user completes the
  // purchase with their own account. The agent does NOT place the order or take
  // payment. Does not clear the cart — the page is the terminal step. UI-linked
  // so the widget's Checkout button routes here. Empty cart → isError.
  registerAppTool(
    server,
    "checkout",
    {
      title: "Checkout",
      description:
        "Hand off to checkout: snapshot the cart into an order and return a checkout link for the user " +
        "to complete the purchase on the merchant page. Does not place the order or take payment.",
      inputSchema: {},
      annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
      _meta: UI_META,
    },
    async (): Promise<CallToolResult> => {
      if (cart.size === 0) {
        return {
          content: [{ type: "text", text: "The cart is empty — add items before checking out." }],
          isError: true,
        };
      }
      const items = [...cart.entries()].map(([productId, quantity]) => ({ productId, quantity }));
      const { orderId, checkoutUrl } = createCheckoutOrder(items);
      return {
        structuredContent: { orderId, checkoutUrl },
        content: [{ type: "text", text: JSON.stringify({ orderId, checkoutUrl }) }],
      };
    },
  );

  // The UI resource for MCP hosts (Claude): bundled single-file HTML. The iframe
  // renders under a strict CSP; product images load from picsum (which redirects
  // to fastly), so both hosts must be allowlisted or images are blocked.
  registerAppResource(
    server,
    RESOURCE_URI,
    RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => ({
      contents: [
        {
          uri: RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: await loadBundle(),
          _meta: { ui: { csp: { resourceDomains: IMAGE_DOMAINS } } },
        },
      ],
    }),
  );

  // The same bundle for ChatGPT, served with the skybridge mime and ChatGPT's
  // CSP key. ChatGPT injects window.openai into this iframe; the bundle detects
  // it at runtime (see src/app.tsx).
  server.registerResource(
    "product-picker-skybridge",
    SKYBRIDGE_URI,
    { mimeType: SKYBRIDGE_MIME },
    async (): Promise<ReadResourceResult> => ({
      contents: [
        {
          uri: SKYBRIDGE_URI,
          mimeType: SKYBRIDGE_MIME,
          text: await loadBundle(),
          _meta: {
            "openai/widgetCSP": {
              connect_domains: [],
              resource_domains: IMAGE_DOMAINS,
            },
          },
        },
      ],
    }),
  );

  return server;
}
