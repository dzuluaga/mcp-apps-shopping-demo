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

function renderCheckoutPage(baseOrder: Order, v: CheckoutVerification = {}, paid: CompletedOrder | null = null): string {
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

  // Shopify-style payment section: one radio group of methods, one Pay CTA.
  // The selected method decides where the CTA goes (gate page) or what it does
  // (instant demo). When age-blocked, the whole group is withheld — server-side
  // enforcement still backs this (the lock is not just rendered).
  // Revisited after completion: the page reports the payment instead of
  // re-offering methods. Settlement details (when the payment settled on-chain)
  // carry the public proof.
  const paidSection = paid
    ? `<div class="ok" style="font-size:16px;">\u2713 Order paid \u00b7 ${formatMoney(paid.amount, paid.currency)}${paid.settlement ? " via x402" : paid.method === "passkey" ? " via passkey" : ""}</div>` +
      (paid.settlement
        ? `<div class="note" style="text-align:left;">Settled on ${escapeHtml(paid.settlement.network)} \u00b7 paid from ${escapeHtml(paid.settlement.payer.accountId)} \u00b7 <a href="${paid.settlement.hashscanUrl}" target="_blank" rel="noopener">View on HashScan</a></div>`
        : `<div class="note" style="text-align:left;">No on-chain settlement for this payment method.</div>`)
    : "";

  const payLabel = `Pay ${formatMoney(order.total, order.currency)}`;
  const paymentSection = blocked
    ? `<div class="locked">Payment is locked until age verification is complete.</div>`
    : `<h2 class="pm-head">Payment method</h2>
  <div class="pm-group" role="radiogroup" aria-label="Payment method">
    <label class="pm-row">
      <input type="radio" name="pm" value="passkey" checked />
      <span class="pm-text"><span class="pm-name">Pay with x402 Hedera · Passkey</span>
      <span class="pm-desc">Authorize with this device's passkey — settles on-chain via the x402 protocol (test network).</span></span>
    </label>
    <label class="pm-row">
      <input type="radio" name="pm" value="xdev" />
      <span class="pm-text"><span class="pm-name">Authorize on my phone (cross-device)</span>
      <span class="pm-desc">Scan a QR and approve with your phone's passkey or wallet.</span></span>
    </label>
    <label class="pm-row">
      <input type="radio" name="pm" value="demo" />
      <span class="pm-text"><span class="pm-name">Place order (instant demo)</span>
      <span class="pm-desc">Skips the device prompt — no real charge, nothing settles.</span></span>
    </label>
  </div>
  <button id="pay" class="btn-pay">${payLabel}</button>
  <div class="note">You'll confirm the exact amount with your device. Demo — no real charge.</div>`;

  const placeScript = blocked
    ? ""
    : `<script>
    const GATE_URLS = { passkey: '/payment-gate/passkey?order=${enc}', xdev: '/payment-gate/dc-payment?order=${enc}' };
    const PAY_LABEL = ${JSON.stringify(payLabel)};
    const pay = document.getElementById('pay');
    const selected = () => document.querySelector('input[name="pm"]:checked').value;
    // The CTA narrates the chosen method, Shopify-style.
    const relabel = () => {
      const m = selected();
      pay.textContent = m === 'demo' ? 'Place order (instant demo)' : PAY_LABEL;
    };
    document.querySelectorAll('input[name="pm"]').forEach((r) => r.addEventListener('change', relabel));
    relabel();
    pay.addEventListener('click', async function () {
      const m = selected();
      if (m !== 'demo') { window.location.href = GATE_URLS[m]; return; }
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
  a.btn-ghost, a.btn-age { display:block; text-align:center; text-decoration:none; border-radius:8px; box-sizing:border-box; }
  a.btn-ghost { margin-top: 12px; padding: 12px; font-size: 14px; font-weight: 500; color: #1a7f37; background: #fff; border: 1px solid #1a7f37; }
  a.btn-age { margin-top: 4px; padding: 14px; font-size: 15px; font-weight: 600; color: #fff; background: #b00020; }
  .pm-head { font-size: 15px; margin: 0 0 8px; }
  .pm-group { border: 1px solid #d0d0d0; border-radius: 10px; overflow: hidden; }
  .pm-row { display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; cursor: pointer; border-bottom: 1px solid #eee; }
  .pm-row:last-child { border-bottom: none; }
  .pm-row:has(input:checked) { background: #f2faf4; box-shadow: inset 3px 0 0 #1a7f37; }
  .pm-row input { margin-top: 3px; accent-color: #1a7f37; }
  .pm-text { display: block; }
  .pm-name { display: block; font-size: 14px; font-weight: 600; }
  .pm-desc { display: block; font-size: 12px; color: #666; margin-top: 2px; }
  button.btn-pay { margin-top: 14px; width: 100%; padding: 14px; font-size: 15px; font-weight: 600; color: #fff; background: #1a7f37; border: none; border-radius: 8px; cursor: pointer; }
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

  ${paid ? `<div class="section">${paidSection}</div>` : `<div class="section">${loyaltySection}</div>
  ${ageSection ? `<div class="section">${ageSection}</div>` : ""}
  <div class="section">${paymentSection}</div>
  ${placeScript}`}
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
  // The recorded completion for THIS order, if any: a revisited checkout page
  // shows the paid state instead of re-offering payment methods.
  completedOrder: CompletedOrder | null = null,
): { status: number; html: string } {
  const order = token ? decodeOrder(token) : undefined;
  if (!order) return { status: 404, html: renderNotFound() };
  const paid = completedOrder?.orderId === order.id ? completedOrder : null;
  // decodeOrder only checks the order's top-level shape. A token can still
  // decode with a bad currency code or a malformed line, which would throw in
  // Intl.NumberFormat / escapeHtml. Fall back to 404 so the stdio listener (raw
  // http, no error middleware) returns cleanly instead of hanging the socket.
  try {
    return { status: 200, html: renderCheckoutPage(order, verification, paid) };
  } catch {
    return { status: 404, html: renderNotFound() };
  }
}
