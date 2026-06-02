import http from "node:http";
import { randomBytes } from "node:crypto";
import { createOrder, type CartItemInput, type Order } from "./catalog.js";
import type { CompletedOrder } from "./orderStore.js";

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

// The origin the checkout link (and the widget's order-status poll) target.
// The embedded widget must list this in its CSP connect-src or the poll's
// fetch is blocked, so the UI resource derives connectDomains from it.
export function getCheckoutBaseUrl(): string {
  return checkoutBaseUrl;
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

// Build a completed-order record for the instant-demo path (no device prompt).
// Mirrors what the payment gates write on success so the agent's confirmation
// poll sees the same shape, but marks the method/gates as a demo.
export function demoCompletedOrder(token: string): CompletedOrder | null {
  const order = decodeOrder(token);
  if (!order) return null;
  return {
    orderId: order.id,
    mandateId: `demo_${order.id}`,
    amount: order.total,
    currency: order.currency,
    method: "instant-demo",
    instrument: { issuer: "demo", maskedAccount: null, holder: null },
    gates: [{ gate: "Instant demo", pass: true, detail: "Device authorization skipped (demo)" }],
    completedAt: new Date().toISOString(),
  };
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

function renderCheckoutPage(order: Order, token: string): string {
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
  .note { color: #888; font-size: 12px; margin-top: 12px; text-align: center; }
  button { display: block; margin-top: 12px; width: 100%; padding: 12px; font-size: 14px; font-weight: 500; color: #1a1a1a; background: #fff; border: 1px solid #d0d0d0; border-radius: 8px; cursor: pointer; box-sizing: border-box; }
  button:disabled { color: #888; cursor: default; }
</style>
</head>
<body>
  <h1>Checkout</h1>
  <div class="meta">Order ${escapeHtml(order.id)} · ${order.itemCount} item(s)</div>
  <table>
    ${rows}
    <tr class="total"><td>Total</td><td class="num">${formatMoney(order.total, order.currency)}</td></tr>
  </table>
  <a id="authorize" href="/payment-gate/passkey?order=${encodeURIComponent(token)}"
     style="display:block;margin-top:24px;width:100%;padding:14px;font-size:15px;font-weight:600;
     text-align:center;color:#fff;background:#1a7f37;border-radius:8px;text-decoration:none;box-sizing:border-box;">
    Authorize payment with a passkey
  </a>
  <a id="authorize-xdev" href="/payment-gate/dc-payment?order=${encodeURIComponent(token)}"
     style="display:block;margin-top:10px;width:100%;padding:12px;font-size:14px;font-weight:500;
     text-align:center;color:#1a7f37;background:#fff;border:1px solid #1a7f37;border-radius:8px;text-decoration:none;box-sizing:border-box;">
    Authorize on my phone (cross-device)
  </a>
  <div class="note">You'll confirm the exact amount with your device. Demo — no real charge.</div>
  <button id="place">Place order (instant demo)</button>
  <div class="note">Skips the device prompt — no real charge.</div>
  <script>
    document.getElementById('place').addEventListener('click', async function () {
      this.disabled = true;
      this.textContent = 'Placing order…';
      try {
        const res = await fetch('/checkout/place-order', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ order: ${JSON.stringify(token)} }),
        });
        if (!res.ok) throw new Error('place-order failed: ' + res.status);
        this.textContent = 'Order placed ✓ (demo)';
      } catch (e) {
        this.disabled = false;
        this.textContent = 'Place order (instant demo)';
        alert('Could not place the order. Please try again.');
      }
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
    return { status: 200, html: renderCheckoutPage(order, token!) };
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
