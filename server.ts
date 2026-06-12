import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
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
import { createCheckoutOrder, getCheckoutBaseUrl } from "./checkout.js";
import { cartStore } from "./cartStore.js";
import { orderStore } from "./orderStore.js";
import { qrPngBase64 } from "./payment-gate/qr.js";

// Resolve the bundled UI relative to this module, working from both
// source (server.ts) and compiled (dist/server.js).
const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;

// Hosts (Claude Desktop especially) cache the UI resource by its URI and never
// re-fetch while the URI is unchanged — so a redeploy with a new bundle keeps
// serving the stale widget. Stamp the URI with a short hash of the bundle's
// contents so it changes exactly when the bundle changes, forcing a fresh fetch
// after each meaningful deploy. Computed once at module load (cold start), not
// per request. Falls back to "dev" if the bundle isn't on disk yet.
function bundleVersion(): string {
  const candidates = [
    path.join(DIST_DIR, "mcp-app.html"),
    path.join(process.cwd(), "dist", "mcp-app.html"),
  ];
  for (const candidate of candidates) {
    try {
      return createHash("sha256").update(readFileSync(candidate)).digest("hex").slice(0, 8);
    } catch {
      // try next candidate
    }
  }
  return "dev";
}

const BUNDLE_VERSION = bundleVersion();

// The UI bundle is served twice from the same HTML so one server works in both
// hosts: MCP hosts (Claude) read RESOURCE_URI via _meta.ui.resourceUri; ChatGPT
// reads SKYBRIDGE_URI via _meta["openai/outputTemplate"] and needs the skybridge
// mime. The bundle detects the host at runtime (see src/app.tsx).
export const RESOURCE_URI = `ui://product-picker/mcp-app-${BUNDLE_VERSION}.html`;
export const SKYBRIDGE_URI = `ui://product-picker/mcp-app-${BUNDLE_VERSION}.skybridge.html`;
const SKYBRIDGE_MIME = "text/html+skybridge";

// Domains the iframe needs to load product images (picsum redirects to fastly).
const IMAGE_DOMAINS = ["https://picsum.photos", "https://fastly.picsum.photos"];

// Both hosts find the open widget from any UI-linked tool, so they all carry
// both resource pointers.
const UI_META = {
  ui: { resourceUri: RESOURCE_URI },
  "openai/outputTemplate": SKYBRIDGE_URI,
};

// On Vercel the bundle is included via vercel.json (dist/**) and resolves under
// the function's cwd, which may differ from DIST_DIR. Try the module-relative
// path first, then cwd/dist.
async function loadBundle(): Promise<string> {
  const candidates = [
    path.join(DIST_DIR, "mcp-app.html"),
    path.join(process.cwd(), "dist", "mcp-app.html"),
  ];
  for (const candidate of candidates) {
    try {
      return await fs.readFile(candidate, "utf-8");
    } catch {
      // try next candidate
    }
  }
  throw new Error(`Could not find mcp-app.html in: ${candidates.join(", ")}`);
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

// Shared cart (productId -> quantity). Single source of truth for both the UI
// and the model: the picker UI and the chat agent mutate the same cart, so edits
// from either side stay consistent. Persisted through cartStore — an in-memory
// store locally (survives the per-request server rebuild on the HTTP path, see
// main.ts) and Redis on Vercel (where module memory doesn't persist across
// function instances). Demo-global (not per-conversation). Orders live in
// checkout.ts. Every mutation is read -> mutate -> write so concurrent instances
// converge on the shared store.
// The widget cart is just the selection + subtotal. Age verification and the
// loyalty discount are applied per-order on the checkout web page (end of flow),
// not here, so the cart carries no verification state.
function priceFrom(cart: Map<string, number>): PricedCart {
  const items = [...cart.entries()].map(([productId, quantity]) => ({ productId, quantity }));
  return priceCart(items);
}

async function readPriced(): Promise<PricedCart> {
  return priceFrom(await cartStore.read());
}

async function setQuantity(productId: string, quantity: number): Promise<PricedCart> {
  const cart = await cartStore.read();
  if (quantity <= 0) cart.delete(productId);
  else cart.set(productId, quantity);
  await cartStore.write(cart);
  return priceFrom(cart);
}

// Adds quantities on top of what's already in the cart (the picker's
// "Add to cart" commits a batch; the agent can add items by id too).
async function addToCart(items: { productId: string; quantity: number }[]): Promise<PricedCart> {
  const cart = await cartStore.read();
  for (const { productId, quantity } of items) {
    if (quantity <= 0) continue;
    cart.set(productId, (cart.get(productId) ?? 0) + quantity);
  }
  await cartStore.write(cart);
  return priceFrom(cart);
}

async function removeFromCart(productId: string): Promise<PricedCart> {
  const cart = await cartStore.read();
  cart.delete(productId);
  await cartStore.write(cart);
  return priceFrom(cart);
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
      const priced = await readPriced();
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
              `Some items are age-restricted (alcohol). Age verification (21+) and the optional loyalty discount ` +
              `(10% off) happen on the checkout page that the checkout tool returns — the user completes them there ` +
              `before authorizing payment; you don't drive them from chat.\n` +
              `Flow:\n` +
              `1. When items are added, briefly confirm the cart and ask if they want to add more or check out.\n` +
              `2. Adjust the cart by id with add-to-cart, set-quantity, and remove-from-cart; read it with get-cart.\n` +
              `3. To check out, call checkout to get a checkout link and share it with the user — do not try to ` +
              `pay or confirm the order yourself.\n` +
              `4. The user completes the purchase themselves on that page; the widget will tell you when it's done. ` +
              `When the user (or the widget) indicates the purchase completed, call get-order-status to fetch the ` +
              `details and confirm to the user: the order ID, the total, and that their items are on the way.\n` +
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
      return cartResult(await addToCart(items));
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
      return cartResult(await setQuantity(productId, quantity));
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
      return cartResult(await removeFromCart(productId));
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
      return cartResult(await readPriced());
    },
  );

  // Note: age verification and the loyalty discount are handled entirely on the
  // checkout web page (the order link from the `checkout` tool), scoped to that
  // order. There are no separate verify/loyalty tools — the user does both on
  // that page before authorizing payment.

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
        "to complete the purchase on the merchant page. Does not place the order or take payment. " +
        "The picker passes the on-screen cart via `items`; called without items, it falls back to the shared cart.",
      // The widget passes its exact on-screen cart so checkout always matches
      // what the user sees, even if the shared server cart is briefly out of
      // sync (e.g. a host that doesn't round-trip widget tool calls reliably).
      // The order is built purely from these items and carried in the link's
      // token, so the whole hand-off is independent of cartStore persistence.
      inputSchema: {
        items: z
          .array(z.object({ productId: z.string(), quantity: z.number().int().min(1) }))
          .optional(),
      },
      annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
      _meta: UI_META,
    },
    async ({ items }): Promise<CallToolResult> => {
      let entries: { productId: string; quantity: number }[];
      if (items && items.length > 0) {
        entries = items;
        // Reconcile the shared cart so later get-cart reads match the order.
        await cartStore.write(new Map(items.map((i) => [i.productId, i.quantity])));
      } else {
        const cart = await cartStore.read();
        entries = [...cart.entries()].map(([productId, quantity]) => ({ productId, quantity }));
      }
      if (entries.length === 0) {
        return {
          content: [{ type: "text", text: "The cart is empty — add items before checking out." }],
          isError: true,
        };
      }
      const { orderId, checkoutUrl } = createCheckoutOrder(entries);
      return {
        structuredContent: { orderId, checkoutUrl },
        content: [{ type: "text", text: JSON.stringify({ orderId, checkoutUrl }) }],
      };
    },
  );

  // Poll for purchase completion. The checkout hand-off happens on a page outside
  // the agent, and MCP has no server->client push, so after sharing a checkout link
  // the agent calls this to learn whether the user finished authorizing. On success
  // the gate also clears the cart, so get-cart returning empty is a second signal.
  // Model-only (not UI-linked): the agent reports the result in chat.
  server.registerTool(
    "get-order-status",
    {
      title: "Get Order Status",
      description:
        "Read-only check of the user's most recent completed purchase. The user initiates and completes checkout " +
        "themselves; this tool only reports status. Returns the completed order — order ID, amount, currency, " +
        "payment instrument, and the authorization gate results — or a note that none is complete yet. Call it once " +
        "the user (or the widget) says the purchase finished, then confirm the order ID and total to the user and " +
        "tell them their items are on the way. If the order carries a `settlement` block, the payment really settled " +
        "on-chain via the x402 protocol: tell the user which account paid (settlement.payer.accountId — when payer.kind is session-wallet, a fresh " +
        "wallet created just for this order), and share the public explorer link (settlement.hashscanUrl) so they " +
        "can verify the transaction themselves. The result then also carries a QR-code image of that link, rendered " +
        "in the conversation — tell the user they can scan it with their phone to open the transaction on HashScan. " +
        "Pass orderId to require a specific order.",
      inputSchema: { orderId: z.string().optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ orderId }): Promise<CallToolResult> => {
      const order = await orderStore.read();
      const matches = !!order && (!orderId || order.orderId === orderId);
      if (!matches) {
        return {
          content: [
            { type: "text", text: "No completed purchase yet — the user hasn't finished authorizing on the checkout page." },
          ],
        };
      }
      const content: CallToolResult["content"] = [{ type: "text", text: JSON.stringify(order) }];
      // Settled on-chain: attach a scannable QR of the explorer link so the
      // proof lands in the conversation itself, not only on the gate page.
      // Best-effort — a QR failure must never break the status report.
      if (order.settlement) {
        try {
          const data = await qrPngBase64(order.settlement.hashscanUrl);
          content.push({ type: "image", data, mimeType: "image/png" });
        } catch {
          // text + structured content still carry the link
        }
      }
      return {
        structuredContent: order as unknown as Record<string, unknown>,
        content,
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
          // resourceDomains covers images (img-src). connectDomains is separate
          // and maps to connect-src: without it the widget's order-status poll
          // fetch to our own origin is blocked, so checkout completion never
          // reaches the chat. Allowlist exactly the checkout origin we hand out.
          _meta: {
            ui: {
              csp: { resourceDomains: IMAGE_DOMAINS, connectDomains: [getCheckoutBaseUrl()] },
            },
          },
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
              connect_domains: [getCheckoutBaseUrl()],
              resource_domains: IMAGE_DOMAINS,
            },
          },
        },
      ],
    }),
  );

  return server;
}
