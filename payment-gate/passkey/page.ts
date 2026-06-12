// Server-rendered passkey gate page. Shows the binding fields (amount/order),
// then runs ONE registration ceremony and POSTs the result with the challenge +
// order tokens. Loads @simplewebauthn/browser ESM from a same-origin static path.
import type { Order } from "../../catalog.js";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function money(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}

export function renderPasskeyPage(args: { order: Order; orderToken: string; crossDevice?: boolean }): string {
  const { order, orderToken, crossDevice = false } = args;
  const rows = order.lines
    .map((l) => `<tr><td>${escapeHtml(l.name)} <span style="color:#999;">×${l.quantity}</span></td><td class="amt">${money(l.lineTotal, l.currency)}</td></tr>`)
    .join("\n");
  const token = escapeHtml(orderToken);
  // crossDevice pins the registration to a roaming authenticator, so the browser
  // skips local Touch ID and shows the QR for a phone (caBLE). The toggle link
  // flips the mode by adding/removing the xdev param on the same gate URL.
  const optionsUrl = crossDevice ? "/payment-gate/passkey/options?xdev=1" : "/payment-gate/passkey/options";
  const toggle = crossDevice
    ? `<a class="toggle" href="/payment-gate/passkey?order=${token}">← Use this device instead</a>`
    : `<a class="toggle" href="/payment-gate/passkey?order=${token}&amp;xdev=1">Use my phone instead (scan a QR) →</a>`;
  // Not a dead end: back to the checkout page, where loyalty/age status lives.
  const backToCheckout = `<a class="toggle" href="/checkout?order=${token}">← Back to checkout</a>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Authorize payment · ${escapeHtml(order.id)}</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 880px; margin: 3rem auto; padding: 0 1.25rem; color: #1a1a1a; }
  .cols { display: flex; gap: 2rem; align-items: flex-start; }
  .main { flex: 1; min-width: 0; }
  aside.info { width: 250px; flex-shrink: 0; background: #f6f8f7; border: 1px solid #e3e8e5; border-radius: 10px; padding: 0.4rem 1rem 0.9rem; font-size: 0.82rem; color: #555; line-height: 1.5; }
  aside.info h2 { font-size: 0.9rem; color: #1a1a1a; margin-bottom: 0; }
  @media (max-width: 720px) { .cols { flex-direction: column; } aside.info { width: auto; } }
  h1 { font-size: 1.35rem; margin-bottom: 0.25rem; }
  p.lede { color: #555; margin-top: 0; line-height: 1.45; }
  table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 0.95rem; }
  td { padding: 0.35rem 0; border-bottom: 1px solid #f0f0f0; }
  td.amt { text-align: right; font-variant-numeric: tabular-nums; }
  tr.total td { border-bottom: none; font-weight: 600; padding-top: 0.6rem; }
  button { font-size: 1rem; padding: 0.75rem 1.1rem; border-radius: 6px; border: 1px solid #1a7f37; background: #1a7f37; color: #fff; cursor: pointer; width: 100%; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .step { padding: 0.4rem 0; font-family: ui-monospace, Menlo, monospace; font-size: 0.85rem; }
  .step.ok { color: #0a7f2e; } .step.err { color: #b00020; white-space: pre-wrap; }
  #receipt { display: none; margin-top: 1.25rem; padding: 1rem 1.1rem; background: #ecfdf3; border-left: 4px solid #0a7f2e; border-radius: 6px; }
  #bar { display: none; margin: 0.75rem 0 0.25rem; height: 6px; background: #e6f2ea; border-radius: 3px; overflow: hidden; }
  #bar.on { display: block; }
  #bar > div { width: 35%; height: 100%; background: #1a7f37; border-radius: 3px; animation: slide 1.2s ease-in-out infinite; }
  @keyframes slide { from { margin-left: -35%; } to { margin-left: 100%; } }
  .gate { font-family: ui-monospace, Menlo, monospace; font-size: 0.82rem; padding: 0.15rem 0; }
  .gate.pass { color: #0a7f2e; } .gate.fail { color: #b00020; }
  a.toggle { display: inline-block; margin-top: 0.75rem; font-size: 0.85rem; color: #1a7f37; text-decoration: none; }
  a.toggle:hover { text-decoration: underline; }
  .r-head { font-weight: 600; color: #0a7f2e; margin: 0.9rem 0 0.4rem; }
  .dim { color: #666; font-weight: 400; font-size: 0.78rem; }
  .mono { font-family: ui-monospace, Menlo, monospace; font-size: 0.78rem; word-break: break-all; }
  details.gates { margin: 0.2rem 0 0.4rem; }
  details.gates summary { cursor: pointer; font-weight: 600; color: #0a7f2e; font-size: 0.95rem; }
  details.gates .gate { margin-left: 1rem; }
  dl.kv { display: grid; grid-template-columns: 64px 1fr; gap: 0.3rem 0.75rem; margin: 0.4rem 0 0; font-size: 0.9rem; }
  dl.kv dt { color: #666; font-size: 0.8rem; padding-top: 0.1rem; }
  dl.kv dd { margin: 0; }
</style>
</head>
<body>
  <h1>Authorize payment</h1>
  <p class="lede">An agent prepared this order — confirm the exact amount with your device to pay.</p>
  <div class="cols">
  <div class="main">
  <table>
    ${rows}
    <tr class="total"><td>Total · order ${escapeHtml(order.id)}</td><td class="amt">${money(order.total, order.currency)}</td></tr>
  </table>
  <button id="go">Authorize ${money(order.total, order.currency)}</button>
  <div>${toggle} &nbsp;·&nbsp; ${backToCheckout}</div>
  <div id="log"></div>
  <div id="bar"><div></div></div>
  <div id="receipt"></div>
  </div>
  <aside class="info">
    <h2>How this payment works</h2>
    <p>Your device's secure element (Touch ID, Windows Hello, or a phone via cross-device sign-in) authorizes this exact amount — nothing else.</p>
    <p>Once authorized, payment settles on-chain via the <strong>x402</strong> protocol: a transfer cryptographically bound to this amount and recipient, co-signed and submitted by a facilitator that cannot alter either.</p>
    <p>Settlement runs on a <strong>test network</strong> — no real money moves, and the demo settles a <strong>tiny token amount</strong> (a fixed demo rate, not the dollar total).</p>
  </aside>
  </div>
  <script type="module">
    import { startRegistration } from "/payment-gate/lib/sw/index.js";
    const ORDER_TOKEN = ${JSON.stringify(token)};
    const OPTIONS_URL = ${JSON.stringify(optionsUrl)};
    const checkoutUrl = "/checkout?order=" + encodeURIComponent(ORDER_TOKEN);
    const log = document.getElementById("log");
    const bar = document.getElementById("bar");
    const btn = document.getElementById("go");
    const step = (t, c = "") => { const d = document.createElement("div"); d.className = "step " + c; d.textContent = t; log.appendChild(d); };
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        step("→ GET options");
        const { options, challengeToken } = await fetch(OPTIONS_URL).then((r) => r.json());
        step("→ Touch ID / passkey prompt");
        const response = await startRegistration({ optionsJSON: options });
        step("→ verify · Settling via x402 on Hedera testnet (if configured)… can take ~10s");
        // Two on-chain consensus rounds (wallet mint + transfer) happen inside
        // this one request — show an indeterminate bar so the wait reads as
        // progress, not a hang.
        bar.classList.add("on");
        const out = await fetch("/payment-gate/passkey/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ response, challengeToken, orderToken: ORDER_TOKEN }),
        }).then((r) => r.json()).finally(() => bar.classList.remove("on"));
        if (!out.mandate) throw new Error(out.error || "authorization failed");
        step("✓ authorized · mandate built", "ok");
        renderReceipt(out);
        if (out.settlementError) step("✗ settlement failed — authorized, not settled (retry below)", "err");
        if (!out.completed) btn.disabled = false;
      } catch (err) {
        step("✗ " + (err?.message ?? String(err)), "err");
        btn.disabled = false;
      }
    });
    function renderReceipt(out) {
      const el = document.getElementById("receipt");
      const passCount = out.gates.filter((g) => g.pass).length;
      const allPass = passCount === out.gates.length;
      const gateLines = out.gates.map((g) => '<div class="gate ' + (g.pass ? "pass" : "fail") + '">' + (g.pass ? "\u2713" : "\u2717") + " " + esc(g.gate) + " \u2014 " + esc(g.detail) + "</div>").join("");
      // Collapsed by default when everything passed: one summary line, with the
      // technical gate details one click away. Failures render expanded.
      const gates = '<details class="gates"' + (allPass ? "" : " open") + "><summary>" +
        (allPass ? "\u2713 All " + out.gates.length + " authorization gates passed" : "\u2717 " + (out.gates.length - passCount) + " of " + out.gates.length + " authorization gates failed") +
        ' <span class="mono dim">' + esc(out.mandate.id) + "</span></summary>" + gateLines + "</details>";
      const s = out.settlement;
      const settlement = s
        ? '<div class="r-head">\u2713 Settled via x402 on Hedera testnet</div>' +
          '<dl class="kv">' +
          // Actual on-chain amount (tinybar \u2192 \u210f); Number formatting trims trailing zeros.
          "<dt>Amount</dt><dd>" + (s.amountTinybar / 1e8) + ' \u210f <span class="dim">(' + s.fxRate + ")</span></dd>" +
          "<dt>From</dt><dd>" + s.payer.accountId + ' <span class="dim">' +
          (s.payer.kind === "session-wallet"
            ? "wallet created for this order, " + (s.walletAgeMs / 1000).toFixed(1) + "s old when it paid"
            : "demo customer") + "</span></dd>" +
          "<dt>To</dt><dd>" + s.payTo + ' <span class="dim">merchant</span></dd>' +
          "<dt>Speed</dt><dd>settled in " + (s.settledInMs / 1000).toFixed(1) + "s</dd>" +
          '<dt>Tx</dt><dd><span class="mono">' + esc(s.txId) + "</span> \u00b7 " +
          '<a href="' + s.hashscanUrl + '" target="_blank" rel="noopener">View on HashScan</a></dd>' +
          "</dl>" +
          // Scannable third-party proof: phones land on the live explorer
          // directly, no trust in this screen. hashscanUrl is server-built
          // (fixed prefix) and the QR endpoint re-checks the prefix.
          '<div style="margin-top:0.6rem;text-align:center;"><img src="/payment-gate/qr?data=' +
          encodeURIComponent(s.hashscanUrl) +
          '" alt="QR code to the HashScan transaction" width="120" height="120" style="display:block;margin:0 auto;border:4px solid #fff;border-radius:6px;" />' +
          '<div class="dim" style="margin-top:0.25rem;">Scan to verify on HashScan</div></div>'
        : out.settlementError
          ? '<div class="gate fail">\u2717 Settlement failed \u2014 authorized, not settled: ' + esc(out.settlementError) + "</div>"
          : "";
      const done = out.completed
        ? "<div style=\\"background:#0a7f2e;color:#fff;font-size:1.1rem;font-weight:700;line-height:1.4;padding:1rem 1.1rem;border-radius:8px;margin-bottom:1rem;text-align:center;\\">\u2713 Purchase complete<div style=\\"font-size:0.9rem;font-weight:500;margin-top:0.25rem;\\">You can close this page and return to the chat \u2014 or <a style=\\"color:#fff;\\" href=\\"" + checkoutUrl + "\\">go back to checkout</a>.</div></div>"
        : "";
      el.innerHTML = done + gates + settlement;
      el.style.display = "block";
      if (out.completed) btn.textContent = "Authorized \u2713";
    }
  </script>
</body>
</html>`;
}
