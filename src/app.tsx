import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CART_META_KEY,
  CATALOG,
  CATALOG_META_KEY,
  priceCart as priceCartLocal,
  type CartItemInput,
  type PricedCart,
  type Product,
} from "../catalog";
import styles from "./app.module.css";

type Insets = McpUiHostContext["safeAreaInsets"];
// Commit a staged selection to the cart.
type AddToCartFn = (items: CartItemInput[]) => Promise<void>;
// Hand off to checkout: opens the merchant page in the browser. Only available
// inside a host with a link/open capability; undefined in standalone mode.
type CheckoutFn = () => Promise<void>;

// Minimal shape of ChatGPT's in-iframe bridge. ChatGPT injects `window.openai`
// into skybridge widgets; the methods we use are optional-chained because the
// surface evolves. (MCP hosts like Claude use the ext-apps bridge instead.)
interface OpenAiBridge {
  toolInput?: unknown;
  toolOutput?: unknown;
  callTool?: (name: string, params?: Record<string, unknown>) => Promise<unknown>;
  openExternal?: (opts: { href: string }) => void | Promise<void>;
  sendFollowUpMessage?: (opts: { prompt: string }) => void | Promise<void>;
}
declare global {
  interface Window {
    openai?: OpenAiBridge;
  }
}

type HostMode = "chatgpt" | "mcp" | "standalone";

// Pick the bridge: ChatGPT exposes window.openai; a top-level window (or the
// ?standalone flag) means no host; otherwise we're embedded in an MCP host.
function detectHost(): HostMode {
  if (typeof window !== "undefined" && window.openai) return "chatgpt";
  const params = new URLSearchParams(window.location.search);
  if (params.has("standalone") || window.self === window.top) return "standalone";
  return "mcp";
}

// callTool results may arrive as the raw structuredContent or wrapped in a
// CallToolResult; normalize to the structured payload.
function structuredOf(result: unknown): unknown {
  if (result && typeof result === "object" && "structuredContent" in result) {
    return (result as { structuredContent: unknown }).structuredContent;
  }
  return result;
}

function parseJsonContent<T>(result: CallToolResult): T | null {
  for (const block of result.content ?? []) {
    if (block.type === "text") {
      try {
        return JSON.parse(block.text) as T;
      } catch {
        // not JSON; keep scanning
      }
    }
  }
  return null;
}

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}

// Deterministic muted color from a product id, for image fallbacks.
function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360} 45% 55%)`;
}

// Inline SVG placeholder used when a product image fails to load (e.g. blocked
// by the host CSP). No network required.
function placeholderDataUri(p: Product): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">
<rect width="400" height="300" fill="${colorFor(p.id)}"/>
<text x="200" y="150" fill="rgba(255,255,255,0.95)" font-family="system-ui,sans-serif"
 font-size="22" font-weight="600" text-anchor="middle" dominant-baseline="middle">${p.category}</text>
</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function emptyCart(): PricedCart {
  return { lines: [], itemCount: 0, total: 0, currency: "USD", unknownIds: [] };
}

// Ambient context so the agent always knows the current cart (with ids) and how
// to drive checkout. updateModelContext replaces prior context, so this stays
// fresh without spamming the transcript.
function cartContextMarkdown(cart: PricedCart): string {
  if (cart.lines.length === 0) {
    return "The product picker is open. The user's cart is currently empty.";
  }
  const lines = cart.lines
    .map((l) => `- ${l.quantity}× ${l.name} (id: ${l.id}) — ${formatMoney(l.lineTotal, l.currency)}`)
    .join("\n");
  return `The user's current cart:

${lines}

Total: ${formatMoney(cart.total, cart.currency)} (${cart.itemCount} item(s)).

Drive the experience in chat: confirm the cart and ask whether to add more or check out. Adjust items by id with add-to-cart / set-quantity / remove-from-cart. You CANNOT place orders or take payment — for checkout, call the checkout tool to get a link and share it; the user completes the purchase on the merchant page with their own account.`;
}

// ----- Host mode: connects to the MCP host bridge -----

function HostApp() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<PricedCart>(emptyCart());
  const [insets, setInsets] = useState<Insets>();
  const appRef = useRef<Parameters<NonNullable<Parameters<typeof useApp>[0]["onAppCreated"]>>[0] | null>(null);

  const applyCart = useCallback((c: PricedCart) => {
    setCart(c);
    appRef.current
      ?.updateModelContext({ content: [{ type: "text", text: cartContextMarkdown(c) }] })
      .catch(console.error);
  }, []);

  const { app, error } = useApp({
    appInfo: { name: "Product Picker", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      appRef.current = app;
      // Fires for tool results the host routes to this open app — including
      // add-to-cart / set-quantity / get-cart calls the AGENT made in chat.
      // That keeps the cart badge in sync with chat-driven changes.
      app.ontoolresult = async (result) => {
        const catalog = result._meta?.[CATALOG_META_KEY] as { products?: Product[] } | undefined;
        if (catalog?.products) setProducts(catalog.products);
        const metaCart = result._meta?.[CART_META_KEY] as PricedCart | undefined;
        if (metaCart && Array.isArray(metaCart.lines)) {
          applyCart(metaCart);
          return;
        }
        const parsed = parseJsonContent<PricedCart>(result);
        if (parsed && Array.isArray(parsed.lines) && Array.isArray(parsed.unknownIds)) {
          applyCart(parsed);
        }
      };
      app.onhostcontextchanged = (params) => setInsets(params.safeAreaInsets);
      app.onerror = console.error;
    },
  });

  const addToCart = useCallback<AddToCartFn>(async (items) => {
    if (!appRef.current || items.length === 0) return;
    const result = await appRef.current.callServerTool({ name: "add-to-cart", arguments: { items } });
    const parsed = parseJsonContent<PricedCart>(result);
    if (parsed) applyCart(parsed);
    // Brief, natural hand-off so the agent responds. The full cart (with ids) is
    // already in model context via applyCart's updateModelContext, so the message
    // itself doesn't need to itemize what was added.
    await appRef.current.sendMessage({
      role: "user",
      content: [{ type: "text", text: "Added these to my cart." }],
    });
  }, [applyCart]);

  // Hand off to checkout: snapshot the cart into an order (server side) and open
  // the returned merchant URL in the browser. The agent does not place the order
  // or take payment — the user finishes on that page.
  const checkout = useCallback<CheckoutFn>(async () => {
    if (!appRef.current) return;
    const result = await appRef.current.callServerTool({ name: "checkout", arguments: {} });
    const parsed = parseJsonContent<{ checkoutUrl?: string }>(result);
    if (parsed?.checkoutUrl) {
      await appRef.current.openLink({ url: parsed.checkoutUrl });
    }
  }, []);

  if (error) return <div className={styles.status}><strong>Error:</strong> {error.message}</div>;
  if (!app) return <div className={styles.status}>Connecting…</div>;

  return <Picker products={products} cart={cart} insets={insets} addToCart={addToCart} checkout={checkout} />;
}

// ----- ChatGPT mode: connects to the window.openai bridge -----
// Same UI as host mode; only the bridge differs. callServerTool → callTool,
// openLink → openExternal, sendMessage → sendFollowUpMessage, and tool results
// arrive via window.openai.toolOutput (refreshed on the openai:set_globals event)
// instead of ontoolresult.

function ChatGptApp() {
  const oai = window.openai!;
  const [products, setProducts] = useState<Product[]>(CATALOG);
  const [cart, setCart] = useState<PricedCart>(emptyCart());

  // browse-products yields { products, cart }; cart tools yield a PricedCart.
  const applyToolOutput = useCallback((output: unknown) => {
    if (!output || typeof output !== "object") return;
    const o = output as Record<string, unknown>;
    if (Array.isArray(o.products)) setProducts(o.products as Product[]);
    const maybeCart = (o.cart ?? o) as PricedCart;
    if (Array.isArray(maybeCart.lines)) setCart(maybeCart);
  }, []);

  useEffect(() => {
    applyToolOutput(window.openai?.toolOutput);
    const onGlobals = () => applyToolOutput(window.openai?.toolOutput);
    window.addEventListener("openai:set_globals", onGlobals);
    return () => window.removeEventListener("openai:set_globals", onGlobals);
  }, [applyToolOutput]);

  const addToCart = useCallback<AddToCartFn>(async (items) => {
    if (items.length === 0) return;
    const result = await oai.callTool?.("add-to-cart", { items });
    applyToolOutput(structuredOf(result));
    await oai.sendFollowUpMessage?.({ prompt: "Added these to my cart." });
  }, [oai, applyToolOutput]);

  const checkout = useCallback<CheckoutFn>(async () => {
    const result = await oai.callTool?.("checkout", {});
    const url = (structuredOf(result) as { checkoutUrl?: string } | undefined)?.checkoutUrl;
    if (url) await oai.openExternal?.({ href: url });
  }, [oai]);

  return <Picker products={products} cart={cart} addToCart={addToCart} checkout={checkout} />;
}

// ----- Standalone mode: runs in a plain browser with the local catalog -----
// No agent here, so "Add to cart" just accumulates a local cart for the badge.
// Checkout is agent-driven and only available inside an MCP host.

function StandaloneApp() {
  const [cart, setCart] = useState<PricedCart>(emptyCart());
  const qtys = useRef(new Map<string, number>());

  const addToCart = useCallback<AddToCartFn>(async (items) => {
    for (const { productId, quantity } of items) {
      if (quantity <= 0) continue;
      qtys.current.set(productId, (qtys.current.get(productId) ?? 0) + quantity);
    }
    const all = [...qtys.current.entries()].map(([productId, quantity]) => ({ productId, quantity }));
    setCart(priceCartLocal(all));
  }, []);

  return <Picker products={CATALOG} cart={cart} addToCart={addToCart} />;
}

// ----- Selection UI (the only thing that lives in the iframe) -----

interface PickerProps {
  products: Product[];
  cart: PricedCart;
  insets?: Insets;
  addToCart: AddToCartFn;
  checkout?: CheckoutFn;
}

function Picker({ products, cart, insets, addToCart, checkout }: PickerProps) {
  // Staged selection (not yet in the cart). Cleared after "Add to cart".
  const [selection, setSelection] = useState<Map<string, number>>(new Map());
  const [submitting, setSubmitting] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);

  const selectedCount = useMemo(
    () => [...selection.values()].reduce((sum, q) => sum + q, 0),
    [selection],
  );

  const setQty = useCallback((id: string, qty: number) => {
    setSelection((prev) => {
      const next = new Map(prev);
      if (qty <= 0) next.delete(id);
      else next.set(id, qty);
      return next;
    });
  }, []);

  const handleAdd = useCallback(async () => {
    if (selectedCount === 0) return;
    const items = [...selection.entries()].map(([productId, quantity]) => ({ productId, quantity }));
    setSubmitting(true);
    try {
      await addToCart(items);
      setSelection(new Map());
    } catch (e) {
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  }, [selection, selectedCount, addToCart]);

  const handleCheckout = useCallback(async () => {
    if (!checkout || cart.itemCount === 0) return;
    setCheckingOut(true);
    try {
      await checkout();
    } catch (e) {
      console.error(e);
    } finally {
      setCheckingOut(false);
    }
  }, [checkout, cart.itemCount]);

  const mainStyle = useMemo(
    () => ({
      paddingTop: insets?.top,
      paddingRight: insets?.right,
      paddingBottom: insets?.bottom,
      paddingLeft: insets?.left,
    }),
    [insets],
  );

  return (
    <main className={styles.main} style={mainStyle}>
      {products.length === 0 ? (
        <div className={styles.status}>Loading products…</div>
      ) : (
        <div className={styles.grid}>
          {products.map((p) => {
            const qty = selection.get(p.id) ?? 0;
            return (
              <div key={p.id} className={`${styles.card} ${qty > 0 ? styles.cardSelected : ""}`}>
                <img
                  className={styles.thumb}
                  src={p.image}
                  alt={p.name}
                  onError={(e) => {
                    e.currentTarget.onerror = null;
                    e.currentTarget.src = placeholderDataUri(p);
                  }}
                />
                <div className={styles.cardBody}>
                  <span className={styles.category}>{p.category}</span>
                  <span className={styles.name}>{p.name}</span>
                  <span className={styles.desc}>{p.description}</span>
                  <div className={styles.priceRow}>
                    <span className={styles.price}>{formatMoney(p.price, p.currency)}</span>
                    {qty === 0 ? (
                      <button className={styles.addBtn} onClick={() => setQty(p.id, 1)}>
                        Add
                      </button>
                    ) : (
                      <div className={styles.stepper}>
                        <button
                          className={styles.qtyBtn}
                          onClick={() => setQty(p.id, qty - 1)}
                          aria-label={`Decrease ${p.name}`}
                        >
                          −
                        </button>
                        <span className={styles.qty}>{qty}</span>
                        <button
                          className={styles.qtyBtn}
                          onClick={() => setQty(p.id, qty + 1)}
                          aria-label={`Increase ${p.name}`}
                        >
                          +
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className={styles.footer}>
        <span className={styles.summary}>
          {cart.itemCount > 0
            ? `🛒 ${cart.itemCount} in cart · ${formatMoney(cart.total, cart.currency)}`
            : "🛒 Cart is empty"}
        </span>
        <button
          className={styles.confirm}
          disabled={selectedCount === 0 || submitting}
          onClick={handleAdd}
        >
          {submitting
            ? "Adding…"
            : selectedCount === 0
              ? "Select items to add"
              : `Add ${selectedCount} item${selectedCount === 1 ? "" : "s"} to cart`}
        </button>
        {checkout && cart.itemCount > 0 && (
          <button
            className={styles.checkout}
            disabled={checkingOut}
            onClick={handleCheckout}
          >
            {checkingOut ? "Opening…" : "Checkout"}
          </button>
        )}
      </div>
    </main>
  );
}

const HOST_MODE = detectHost();
const Root =
  HOST_MODE === "chatgpt" ? ChatGptApp : HOST_MODE === "standalone" ? StandaloneApp : HostApp;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
