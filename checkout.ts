import http from "node:http";
import { randomBytes } from "node:crypto";
import { createOrder, type CartItemInput, type Order } from "./catalog.js";

// Base URL the checkout link points at. Falls back to localhost for local runs;
// on Vercel it derives from the project's production domain so the link resolves
// from the user's browser. HTTP entry / createApp may override via setCheckoutBaseUrl.
function defaultBaseUrl(): string {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return `http://localhost:${process.env.CHECKOUT_PORT ?? "3030"}`;
}

let checkoutBaseUrl = defaultBaseUrl();

// Point the checkout link at a specific origin (trailing slashes trimmed).
export function setCheckoutBaseUrl(url: string): void {
  checkoutBaseUrl = url.replace(/\/+$/, "");
}

// Random, no persistent counter (a counter cannot survive across serverless
// instances). Six hex chars is plenty for a demo.
function nextOrderId(): string {
  return `ORD-${randomBytes(3).toString("hex").toUpperCase()}`;
}

// An order is an immutable snapshot, so we carry it inside the checkout URL
// instead of persisting it server-side. Stateless: works identically in stdio,
// local HTTP, and serverless. The token is unsigned — anyone with the link can
// read or hand-edit it, so the decoded order is NOT authoritative for pricing or
// payment. Fine for this mock hand-off; a real merchant would sign or look it up.
export function encodeOrder(order: Order): string {
  return Buffer.from(JSON.stringify(order), "utf8").toString("base64url");
}

export function decodeOrder(token: string): Order | undefined {
  try {
    const order = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as Order;
    if (
      !order ||
      typeof order.id !== "string" ||
      !Array.isArray(order.lines) ||
      typeof order.currency !== "string"
    ) {
      return undefined;
    }
    return order;
  } catch {
    return undefined;
  }
}

// Snapshots cart items into an order and returns its id plus the URL of the mock
// checkout page. The order itself rides in the URL's `order` token.
export function createCheckoutOrder(items: CartItemInput[]): { orderId: string; checkoutUrl: string } {
  const order = createOrder(items, nextOrderId());
  const token = encodeOrder(order);
  return { orderId: order.id, checkoutUrl: `${checkoutBaseUrl}/checkout?order=${token}` };
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
<p>The order link appears to be invalid or malformed.</p>
</body></html>`;
}

// Pure mapping from an encoded order token to an HTTP response, shared by the
// stdio-side listener and the express /checkout route.
export function checkoutResponse(token: string | undefined): { status: number; html: string } {
  const order = token ? decodeOrder(token) : undefined;
  if (!order) return { status: 404, html: renderNotFound() };
  // decodeOrder only checks the order's top-level shape. A token can still
  // decode with a bad currency code or a malformed line, which would throw in
  // Intl.NumberFormat / escapeHtml. Fall back to 404 so the stdio listener (raw
  // http, no error middleware) returns cleanly instead of hanging the socket.
  try {
    return { status: 200, html: renderCheckoutPage(order) };
  } catch {
    return { status: 404, html: renderNotFound() };
  }
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
