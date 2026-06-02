// Server-rendered DC payment gate page. Shows the bound amount, then calls
// navigator.credentials.get({digital}) with the server's signed request. Chrome
// 141+ renders the cross-device QR (caBLE); the wallet's encrypted vp_token
// returns here and we POST it back with the reader-context token. Feature-detects
// the API and falls back to the passkey gate when absent.
import type { Order } from "../../catalog.js";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function money(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}

export function renderDcPage(args: { order: Order; orderToken: string }): string {
  const { order, orderToken } = args;
  const token = escapeHtml(orderToken);
  const rows = order.lines
    .map((l) => `<tr><td>${escapeHtml(l.name)} <span style="color:#999;">×${l.quantity}</span></td><td class="amt">${money(l.lineTotal, l.currency)}</td></tr>`)
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Authorize payment (cross-device) · ${escapeHtml(order.id)}</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 560px; margin: 3rem auto; padding: 0 1.25rem; color: #1a1a1a; }
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
  .notice { margin-top: 1rem; padding: 0.9rem 1rem; background: #fff7ed; border-left: 4px solid #d97706; border-radius: 6px; font-size: 0.9rem; }
  #receipt { display: none; margin-top: 1.25rem; padding: 1rem 1.1rem; background: #ecfdf3; border-left: 4px solid #0a7f2e; border-radius: 6px; }
  .gate { font-family: ui-monospace, Menlo, monospace; font-size: 0.82rem; padding: 0.15rem 0; }
  .gate.pass { color: #0a7f2e; } .gate.fail { color: #b00020; }
  a.toggle { display: inline-block; margin-top: 0.75rem; font-size: 0.85rem; color: #1a7f37; }
</style>
</head>
<body>
  <h1>Authorize payment · cross-device</h1>
  <p class="lede">Present a payment credential from your phone wallet. Chrome shows a QR; scanning it uses the cross-device channel (FIDO caBLE). Your wallet signs over this exact amount — nothing is charged (demo).</p>
  <table>
    ${rows}
    <tr class="total"><td>Total · order ${escapeHtml(order.id)}</td><td class="amt">${money(order.total, order.currency)}</td></tr>
  </table>
  <button id="go">Authorize ${money(order.total, order.currency)} with my wallet</button>
  <a class="toggle" href="/payment-gate/passkey?order=${token}">← Use a passkey on this device instead</a>
  <div id="log"></div>
  <div id="receipt"></div>
  <script type="module">
    const ORDER_TOKEN = ${JSON.stringify(token)};
    const log = document.getElementById("log");
    const btn = document.getElementById("go");
    const step = (t, c = "") => { const d = document.createElement("div"); d.className = "step " + c; d.textContent = t; log.appendChild(d); };
    function notice(html) { const d = document.createElement("div"); d.className = "notice"; d.innerHTML = html; log.appendChild(d); }

    btn.addEventListener("click", async () => {
      btn.disabled = true;
      if (!("credentials" in navigator) || !window.DigitalCredential) {
        notice('This browser does not support <code>navigator.credentials.get({digital})</code>. Need <strong>Chrome 141+</strong> (for localhost dev, enable <code>chrome://flags#web-identity-digital-credentials</code>). ' +
          '<a href="/payment-gate/passkey?order=' + ORDER_TOKEN + '">Use a passkey on this device instead →</a>');
        return;
      }
      try {
        step("→ GET signed request");
        const { request, readerContextToken } = await fetch("/payment-gate/dc-payment/request?order=" + encodeURIComponent(ORDER_TOKEN)).then((r) => r.json());
        step("→ navigator.credentials.get({digital}) — Chrome should show a QR…");
        const result = await navigator.credentials.get({ digital: { requests: [{ protocol: "openid4vp-v1-signed", data: { request } }] }, mediation: "required" });
        let data = result?.data ?? null;
        if (typeof data === "string") { try { data = JSON.parse(data); } catch {} }
        step("→ verify");
        const out = await fetch("/payment-gate/dc-payment/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderToken: ORDER_TOKEN, readerContextToken, result: { protocol: result?.protocol ?? null, data } }),
        }).then((r) => r.json());
        if (!out.mandate) throw new Error(out.error || "authorization failed");
        step("✓ presentation verified · mandate built", "ok");
        renderReceipt(out);
      } catch (err) {
        step("✗ " + (err?.message ?? String(err)), "err");
        btn.disabled = false;
      }
    });
    function renderReceipt(out) {
      const el = document.getElementById("receipt");
      const gates = out.gates.map((g) => '<div class="gate ' + (g.pass ? "pass" : "fail") + '">' + (g.pass ? "✓" : "✗") + " " + g.gate + " — " + g.detail + "</div>").join("");
      const done = out.completed
        ? '<div style="background:#0a7f2e;color:#fff;font-size:1.1rem;font-weight:700;line-height:1.4;padding:1rem 1.1rem;border-radius:8px;margin-bottom:1rem;text-align:center;">✓ Purchase complete<div style="font-size:0.9rem;font-weight:500;margin-top:0.25rem;">You can close this page and return to the chat.</div></div>'
        : "";
      el.innerHTML = done + '<div style="font-weight:600;color:#0a7f2e;">✓ Payment Mandate authorized (amount-bound)</div>' +
        '<div style="font-size:0.8rem;color:#666;margin:0.3rem 0 0.6rem;">' + out.mandate.id + "</div>" + gates;
      el.style.display = "block";
      if (out.completed) btn.textContent = "Authorized ✓";
    }
  </script>
</body>
</html>`;
}
