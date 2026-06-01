import http from "node:http";
import { createOrder, type CartItemInput, type Order } from "./catalog.js";

// In-memory order store. Module-scoped so it survives the per-request server
// rebuild on the HTTP path (see main.ts) and is shared with the checkout page
// handler in the same process. Orders are lost on restart.
const orders = new Map<string, Order>();
let orderSeq = 1041; // arbitrary start so demo orders look realistic (ORD-1042…)
function nextOrderId(): string {
  return `ORD-${++orderSeq}`;
}

// Base URL the checkout link points at. Defaults to the standalone listener's
// localhost port, but in HTTP mode main.ts overrides it with the public origin
// (PUBLIC_BASE_URL / the tunnel) so the link resolves from the user's browser.
let checkoutBaseUrl =
  process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.CHECKOUT_PORT ?? "3030"}`;

// Point the checkout link at a specific origin (trailing slashes trimmed).
// Called by the HTTP entrypoint once it knows its public URL.
export function setCheckoutBaseUrl(url: string): void {
  checkoutBaseUrl = url.replace(/\/+$/, "");
}

export function getOrder(id: string): Order | undefined {
  return orders.get(id);
}

// Snapshots cart items into a stored order and returns its id plus the URL of
// the mock checkout page where the user completes the (simulated) purchase.
export function createCheckoutOrder(items: CartItemInput[]): { orderId: string; checkoutUrl: string } {
  const order = createOrder(items, nextOrderId());
  orders.set(order.id, order);
  return { orderId: order.id, checkoutUrl: `${checkoutBaseUrl}/checkout?order=${order.id}` };
}

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderCheckoutPage(order: Order): string {
  const rows = order.lines
    .map(
      (l) => `<tr>
  <td>${l.quantity}× ${escapeHtml(l.name)}</td>
  <td class="num">${formatMoney(l.lineTotal, l.currency)}</td>
</tr>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Checkout · ${escapeHtml(order.id)}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 560px; margin: 40px auto; padding: 0 16px; color: #1a1a1a; }
  h1 { font-size: 20px; }
  .meta { color: #666; font-size: 13px; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 10px 0; border-bottom: 1px solid #eee; font-size: 14px; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .total { font-weight: 600; font-size: 16px; }
  .total td { border-bottom: none; padding-top: 16px; }
  button { margin-top: 24px; width: 100%; padding: 14px; font-size: 15px; font-weight: 600;
    color: #fff; background: #1a7f37; border: none; border-radius: 8px; cursor: pointer; }
  button:disabled { background: #8bbf99; cursor: default; }
  .note { color: #888; font-size: 12px; margin-top: 12px; text-align: center; }
</style>
</head>
<body>
  <h1>Checkout</h1>
  <div class="meta">Order ${escapeHtml(order.id)} · ${order.itemCount} item(s)</div>
  <table>
    ${rows}
    <tr class="total"><td>Total</td><td class="num">${formatMoney(order.total, order.currency)}</td></tr>
  </table>
  <button id="place">Place order</button>
  <div class="note">Demo checkout — no real charge.</div>
  <script>
    document.getElementById('place').addEventListener('click', function () {
      this.disabled = true;
      this.textContent = 'Order placed ✓ (demo)';
    });
  </script>
</body>
</html>`;
}

function renderNotFound(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<title>Order not found</title>
<style>body{font-family:system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 16px;color:#1a1a1a}</style>
</head><body><h1>Order not found</h1>
<p>No order matches that link. It may have expired (orders are kept in memory and lost on restart).</p>
</body></html>`;
}

// Pure mapping from an order id to an HTTP response, shared by the stdio-side
// listener and the express HTTP entrypoint.
export function checkoutResponse(orderId: string | undefined): { status: number; html: string } {
  const order = orderId ? orders.get(orderId) : undefined;
  if (!order) return { status: 404, html: renderNotFound() };
  return { status: 200, html: renderCheckoutPage(order) };
}

// Lightweight standalone listener for the mock checkout page. Started alongside
// the stdio transport so `openLink` has something to open in the browser.
export function startCheckoutHttpServer(
  port = Number(process.env.CHECKOUT_PORT ?? 3030),
): http.Server {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    if (url.pathname === "/checkout") {
      const { status, html } = checkoutResponse(url.searchParams.get("order") ?? undefined);
      res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    res.end(renderNotFound());
  });
  server.listen(port, () => {
    checkoutBaseUrl = `http://localhost:${port}`;
    console.error(`Checkout page on ${checkoutBaseUrl}/checkout`);
  });
  return server;
}
