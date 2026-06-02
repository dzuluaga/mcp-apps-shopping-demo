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
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Authorize payment · ${escapeHtml(order.id)}</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 540px; margin: 3rem auto; padding: 0 1.25rem; color: #1a1a1a; }
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
  .gate { font-family: ui-monospace, Menlo, monospace; font-size: 0.82rem; padding: 0.15rem 0; }
  .gate.pass { color: #0a7f2e; } .gate.fail { color: #b00020; }
  a.toggle { display: inline-block; margin-top: 0.75rem; font-size: 0.85rem; color: #1a7f37; text-decoration: none; }
  a.toggle:hover { text-decoration: underline; }
</style>
</head>
<body>
  <h1>Authorize payment</h1>
  <p class="lede">An agent prepared this order. Authorize the exact amount with your device's secure element (Touch ID, Windows Hello, or a phone via cross-device sign-in). Nothing is charged — this is a demo authorization ceremony.</p>
  <table>
    ${rows}
    <tr class="total"><td>Total · order ${escapeHtml(order.id)}</td><td class="amt">${money(order.total, order.currency)}</td></tr>
  </table>
  <button id="go">Authorize ${money(order.total, order.currency)}</button>
  <div>${toggle}</div>
  <div id="log"></div>
  <div id="receipt"></div>
  <script type="module">
    import { startRegistration } from "/payment-gate/lib/sw/index.js";
    const ORDER_TOKEN = ${JSON.stringify(token)};
    const OPTIONS_URL = ${JSON.stringify(optionsUrl)};
    const log = document.getElementById("log");
    const btn = document.getElementById("go");
    const step = (t, c = "") => { const d = document.createElement("div"); d.className = "step " + c; d.textContent = t; log.appendChild(d); };
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        step("→ GET options");
        const { options, challengeToken } = await fetch(OPTIONS_URL).then((r) => r.json());
        step("→ Touch ID / passkey prompt");
        const response = await startRegistration({ optionsJSON: options });
        step("→ verify");
        const out = await fetch("/payment-gate/passkey/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ response, challengeToken, orderToken: ORDER_TOKEN }),
        }).then((r) => r.json());
        if (!out.mandate) throw new Error(out.error || "authorization failed");
        step("✓ authorized · mandate built", "ok");
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
        ? "<div style=\\"background:#0a7f2e;color:#fff;font-size:1.1rem;font-weight:700;line-height:1.4;padding:1rem 1.1rem;border-radius:8px;margin-bottom:1rem;text-align:center;\\">✓ Purchase complete<div style=\\"font-size:0.9rem;font-weight:500;margin-top:0.25rem;\\">You can close this page and return to the chat.</div></div>"
        : "";
      el.innerHTML = done + "<div style=\\"font-weight:600;color:#0a7f2e;\\">✓ Payment Mandate authorized</div>" +
        "<div style=\\"font-size:0.8rem;color:#666;margin:0.3rem 0 0.6rem;\\">" + out.mandate.id + "</div>" + gates;
      el.style.display = "block";
      if (out.completed) btn.textContent = "Authorized ✓";
    }
  </script>
</body>
</html>`;
}
