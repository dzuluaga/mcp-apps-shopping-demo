import http from "node:http";
import { randomBytes } from "node:crypto";
import { createOrder, requiredAgeForLines, LOYALTY_DISCOUNT_PCT, type CartItemInput, type Order, type PriceOpts } from "./catalog.js";
import type { CompletedOrder } from "./orderStore.js";
import { verificationStore } from "./verificationStore.js";

// Server-side age gate. The checkout page's payment lock is render-only, so a
// direct POST to any completion endpoint could otherwise place an age-restricted
// order without verification. Every completion path must call this and refuse to
// write the order when it returns true. Returns true iff the order contains an
// age-restricted item AND this order has no recorded age verification.
export async function isAgeUnverified(order: Order): Promise<boolean> {
  if (requiredAgeForLines(order.lines) == null) return false;
  const v = await verificationStore.read(order.id);
  return !v.ageVerified;
}

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
export function createCheckoutOrder(
  items: CartItemInput[],
  opts: PriceOpts = {},
): { orderId: string; checkoutUrl: string } {
  const order = createOrder(items, nextOrderId(), opts);
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

// Verification state that drives the end-of-flow gating on the checkout page.
export interface CheckoutVerification {
  ageVerified?: boolean;
  loyaltyApplied?: boolean;
}

// Recompute the order's discount/total from its subtotal given the current
// loyalty state, so the displayed total — and the token the payment gates bind
// to — always reflect what the user has done on this page.
function recomputeOrder(order: Order, loyaltyApplied: boolean): Order {
  const subtotal = order.subtotal;
  const discount = loyaltyApplied ? Math.round(subtotal * (LOYALTY_DISCOUNT_PCT / 100) * 100) / 100 : 0;
  const total = Math.round((subtotal - discount) * 100) / 100;
  return { ...order, subtotal, discount, total };
}

function renderCheckoutPage(baseOrder: Order, v: CheckoutVerification = {}): string {
  const loyaltyApplied = !!v.loyaltyApplied;
  const ageVerified = !!v.ageVerified;
  const order = recomputeOrder(baseOrder, loyaltyApplied);
  // Discounted token: the payment gates decode this and bind to order.total.
  const token = encodeOrder(order);
  const enc = encodeURIComponent(token);
  const requiredAge = requiredAgeForLines(order.lines);
  const hasAgeRestricted = requiredAge != null;
  const blocked = hasAgeRestricted && !ageVerified;

  const rows = order.lines
    .map((l) => `<tr><td>${l.quantity}× ${escapeHtml(l.name)}</td><td class="num">${formatMoney(l.lineTotal, l.currency)}</td></tr>`)
    .join("\n");

  const loyaltySection = loyaltyApplied
    ? `<div class="ok">✓ Loyalty discount applied (${LOYALTY_DISCOUNT_PCT}% off)</div>`
    : `<a class="btn-ghost" href="/credential-gate/loyalty?order=${enc}">🎟️ Apply loyalty discount (${LOYALTY_DISCOUNT_PCT}% off)</a>`;

  const ageSection = !hasAgeRestricted
    ? ""
    : ageVerified
      ? `<div class="ok">✓ Age verified — ${requiredAge}+</div>`
      : `<div class="warn">🔒 This order contains age-restricted items. Verify you're ${requiredAge} or older to continue.</div>
         <a class="btn-age" href="/credential-gate/age?order=${enc}">Verify age (${requiredAge}+)</a>`;

  const paymentSection = blocked
    ? `<div class="locked">Payment is locked until age verification is complete.</div>`
    : `<a id="authorize" class="btn-pay" href="/payment-gate/passkey?order=${enc}">Authorize payment with a passkey</a>
       <a id="authorize-xdev" class="btn-pay-o" href="/payment-gate/dc-payment?order=${enc}">Authorize on my phone (cross-device)</a>
       <div class="note">You'll confirm the exact amount with your device. Demo — no real charge.</div>
       <button id="place">Place order (instant demo)</button>
       <div class="note">Skips the device prompt — no real charge.</div>`;

  const placeScript = blocked
    ? ""
    : `<script>
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
  </script>`;

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
  .disc td { color: #0a7f2e; }
  .total { font-weight: 600; font-size: 16px; }
  .total td { border-bottom: none; padding-top: 16px; }
  .note { color: #888; font-size: 12px; margin-top: 12px; text-align: center; }
  .section { margin-top: 20px; }
  .ok { color: #0a7f2e; font-weight: 600; font-size: 14px; padding: 10px 0; }
  .warn { background: #fff7ed; border-left: 4px solid #d97706; border-radius: 6px; padding: 10px 12px; font-size: 13px; color: #92400e; margin-bottom: 10px; }
  .locked { color: #b00020; font-size: 13px; text-align: center; padding: 14px; border: 1px dashed #e0a0a0; border-radius: 8px; margin-top: 20px; }
  a.btn-ghost, a.btn-age, a.btn-pay, a.btn-pay-o { display:block; text-align:center; text-decoration:none; border-radius:8px; box-sizing:border-box; }
  a.btn-ghost { margin-top: 12px; padding: 12px; font-size: 14px; font-weight: 500; color: #1a7f37; background: #fff; border: 1px solid #1a7f37; }
  a.btn-age { margin-top: 4px; padding: 14px; font-size: 15px; font-weight: 600; color: #fff; background: #b00020; }
  a.btn-pay { margin-top: 8px; padding: 14px; font-size: 15px; font-weight: 600; color: #fff; background: #1a7f37; }
  a.btn-pay-o { margin-top: 10px; padding: 12px; font-size: 14px; font-weight: 500; color: #1a7f37; background: #fff; border: 1px solid #1a7f37; }
  button { display: block; margin-top: 12px; width: 100%; padding: 12px; font-size: 14px; font-weight: 500; color: #1a1a1a; background: #fff; border: 1px solid #d0d0d0; border-radius: 8px; cursor: pointer; box-sizing: border-box; }
  button:disabled { color: #888; cursor: default; }
</style>
</head>
<body>
  <h1>Checkout</h1>
  <div class="meta">Order ${escapeHtml(order.id)} · ${order.itemCount} item(s)</div>
  <table>
    ${rows}
    ${order.discount > 0 ? `<tr class="disc"><td>Loyalty discount (${LOYALTY_DISCOUNT_PCT}%)</td><td class="num">-${formatMoney(order.discount, order.currency)}</td></tr>` : ""}
    <tr class="total"><td>Total</td><td class="num">${formatMoney(order.total, order.currency)}</td></tr>
  </table>

  <div class="section">${loyaltySection}</div>
  ${ageSection ? `<div class="section">${ageSection}</div>` : ""}
  <div class="section">${paymentSection}</div>
  ${placeScript}
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
export function checkoutResponse(
  token: string | undefined,
  verification: CheckoutVerification = {},
): { status: number; html: string } {
  const order = token ? decodeOrder(token) : undefined;
  if (!order) return { status: 404, html: renderNotFound() };
  // decodeOrder only checks the order's top-level shape. A token can still
  // decode with a bad currency code or a malformed line, which would throw in
  // Intl.NumberFormat / escapeHtml. Fall back to 404 so the stdio listener (raw
  // http, no error middleware) returns cleanly instead of hanging the socket.
  try {
    return { status: 200, html: renderCheckoutPage(order, verification) };
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
