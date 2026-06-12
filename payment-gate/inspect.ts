// Mandate inspector — a jwt.io-style page for AP2-shaped mandates (#11).
// Paste a mandate JSON (passkey or DC) or a base64url order token; the server
// detects the artifact, runs the SAME deterministic gates the live flow uses
// (no logic duplicated into browser JS), and the page renders the fields plus
// green/red gate badges. Paste input is attacker-controlled by definition:
// every pasted-derived value the client renders flows through esc().
import express, { type Express, type Request, type Response } from "express";
import { decodeOrder } from "../checkout.js";
import type { Order } from "../catalog.js";
import { orderStore, type SettlementRecord } from "../orderStore.js";
import { deriveOrigin, type Origin } from "./origin.js";
import { runGates, type PasskeyMandate, type GateResult } from "./mandate.js";
import { runDcGates, type DcMandate } from "./dc-payment/mandate.js";

// Generous for any real mandate; a hard cap so the paste box can't be used to
// wedge the JSON parser or the gate decoders with megabytes of input.
export const MAX_INPUT_CHARS = 512_000;

export interface InspectResult {
  kind: "passkey-mandate" | "dc-mandate" | "order-token" | "unknown";
  mandate?: PasskeyMandate | DcMandate;
  order?: Order;
  gates?: GateResult[];
  settlement?: SettlementRecord;
  note?: string;
  error?: string;
}

// The recorded completion, when the pasted artifact names the same order.
async function settlementFor(orderId: string | undefined): Promise<SettlementRecord | undefined> {
  if (!orderId) return undefined;
  const completed = await orderStore.read();
  const s = completed?.orderId === orderId ? completed.settlement : undefined;
  // The record is server-written today, but lock the link to HashScan anyway
  // (same prefix rule as the QR endpoint) so a future settlement source can't
  // turn the inspector's anchor into an arbitrary-scheme link.
  if (s && !s.hashscanUrl.startsWith("https://hashscan.io/")) return { ...s, hashscanUrl: "" };
  return s;
}

export async function inspectArtifact(input: string, origin: Origin): Promise<InspectResult> {
  const trimmed = input.trim();
  if (!trimmed) return { kind: "unknown", error: "empty input" };
  if (trimmed.length > MAX_INPUT_CHARS) return { kind: "unknown", error: "input too large" };

  // 1. Mandate JSON?
  if (trimmed.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      return { kind: "unknown", error: `not valid JSON: ${(err as Error).message}` };
    }
    const m = parsed as Record<string, unknown>;
    if (m?.type !== "ap2.PaymentMandate") {
      return { kind: "unknown", error: 'JSON parsed, but type is not "ap2.PaymentMandate"' };
    }
    const uaType = (m.userAuthorization as Record<string, unknown> | undefined)?.type;
    // Gate functions assume their mandate shape; a hand-crafted paste can break
    // those assumptions anywhere, so a throw becomes a failed parse gate rather
    // than a 500.
    if (uaType === "webauthn.assertion") {
      const mandate = parsed as PasskeyMandate;
      let gates: GateResult[];
      try {
        gates = runGates(mandate);
      } catch (err) {
        gates = [{ gate: "Mandate parse", pass: false, detail: (err as Error).message }];
      }
      return { kind: "passkey-mandate", mandate, gates, settlement: await settlementFor(mandate.cart?.id) };
    }
    if (uaType === "openid4vp-dc-api") {
      const mandate = parsed as DcMandate;
      let gates: GateResult[];
      try {
        gates = runDcGates(mandate, origin);
      } catch (err) {
        gates = [{ gate: "Mandate parse", pass: false, detail: (err as Error).message }];
      }
      return { kind: "dc-mandate", mandate, gates, settlement: await settlementFor(mandate.cart?.id) };
    }
    return { kind: "unknown", error: `ap2.PaymentMandate with unrecognized userAuthorization.type: ${String(uaType)}` };
  }

  // 2. Order token?
  const order = decodeOrder(trimmed);
  if (order) {
    return {
      kind: "order-token",
      order,
      note:
        "Order tokens are unsigned base64url JSON and hand-editable — they are NOT authoritative " +
        "for pricing or payment. The server re-prices every order against the catalog at completion.",
      settlement: await settlementFor(order.id),
    };
  }

  return { kind: "unknown", error: "input is neither a mandate JSON nor a decodable order token" };
}

function renderInspectPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Mandate inspector</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 880px; margin: 3rem auto; padding: 0 1.25rem; color: #1a1a1a; }
  h1 { font-size: 1.35rem; margin-bottom: 0.25rem; }
  p.lede { color: #555; margin-top: 0; line-height: 1.45; }
  textarea { width: 100%; min-height: 180px; font-family: ui-monospace, Menlo, monospace; font-size: 0.8rem; border: 1px solid #d0d0d0; border-radius: 8px; padding: 0.7rem; box-sizing: border-box; }
  button { font-size: 1rem; padding: 0.7rem 1.1rem; border-radius: 6px; border: 1px solid #1a7f37; background: #1a7f37; color: #fff; cursor: pointer; margin-top: 0.6rem; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  #result { display: none; margin-top: 1.25rem; padding: 1rem 1.1rem; background: #f6f8f7; border: 1px solid #e3e8e5; border-radius: 10px; }
  .kindtag { display: inline-block; font-size: 0.75rem; font-weight: 600; padding: 0.15rem 0.5rem; border-radius: 999px; background: #e6f2ea; color: #1a7f37; }
  .gate { font-family: ui-monospace, Menlo, monospace; font-size: 0.82rem; padding: 0.15rem 0; }
  .gate.pass { color: #0a7f2e; } .gate.fail { color: #b00020; }
  .err { color: #b00020; }
  dl.kv { display: grid; grid-template-columns: 110px 1fr; gap: 0.3rem 0.75rem; margin: 0.6rem 0 0; font-size: 0.9rem; }
  dl.kv dt { color: #666; font-size: 0.8rem; padding-top: 0.1rem; }
  dl.kv dd { margin: 0; word-break: break-all; }
  .mono { font-family: ui-monospace, Menlo, monospace; font-size: 0.78rem; }
  .dim { color: #666; font-size: 0.78rem; }
  .note { background: #fff7ed; border-left: 4px solid #d97706; border-radius: 6px; padding: 0.6rem 0.8rem; font-size: 0.82rem; color: #92400e; margin-top: 0.6rem; }
  .r-head { font-weight: 600; color: #0a7f2e; margin: 0.9rem 0 0.2rem; }
</style>
</head>
<body>
  <h1>Mandate inspector</h1>
  <p class="lede">Paste an <strong>AP2-shaped</strong> Payment Mandate (JSON from a gate receipt or verify response) or a base64url <strong>order token</strong> (from a checkout link). The server decodes it and runs the same deterministic gates the live payment flow enforces. Demo mandates carry a <strong>mock</strong> dev signer — cryptographic SD-JWT&nbsp;VC verification arrives with production AP2.</p>
  <textarea id="input" placeholder='{"type":"ap2.PaymentMandate", ...}  — or —  eyJpZCI6Ik9SRC...'></textarea>
  <button id="go">Inspect</button>
  <div id="result"></div>
  <script>
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");
    const el = document.getElementById("result");
    const btn = document.getElementById("go");
    const row = (k, v) => "<dt>" + esc(k) + "</dt><dd>" + v + "</dd>";
    function orderBlock(o) {
      const lines = (o.lines || []).map((l) => esc(l.quantity) + "× " + esc(l.name) + " — " + esc(l.lineTotal)).join("<br>");
      return '<dl class="kv">' +
        row("Order", '<span class="mono">' + esc(o.id) + "</span>") +
        row("Lines", lines || '<span class="dim">none</span>') +
        row("Subtotal", esc(o.subtotal) + " " + esc(o.currency)) +
        row("Discount", esc(o.discount ?? 0)) +
        row("Total", "<strong>" + esc(o.total) + " " + esc(o.currency) + "</strong>") +
        "</dl>";
    }
    function mandateBlock(m) {
      const ua = m.userAuthorization || {};
      return '<dl class="kv">' +
        row("Mandate", '<span class="mono">' + esc(m.id) + "</span> · v" + esc(m.version)) +
        row("Issued", esc(m.issuedAt) + ' <span class="dim">expires ' + esc(m.expiresAt) + "</span>") +
        row("Payment", esc(m.payment?.amount) + " " + esc(m.payment?.currency)) +
        row("Authorization", esc(ua.type) + (ua.userVerified != null ? ' <span class="dim">userVerified=' + esc(ua.userVerified) + "</span>" : "")) +
        ((ua.credentialID || m.subject?.credentialID || m.subject?.credentialId) ? row("Credential", '<span class="mono">' + esc(ua.credentialID ?? m.subject?.credentialID ?? m.subject?.credentialId) + "</span>") : "") +
        (ua.rpID ? row("Bound to", esc(ua.rpID) + ' <span class="dim">' + esc(ua.origin || "") + "</span>") : "") +
        row("Payee", esc(m.payeeId ?? m.cart?.id ?? "")) +
        (m.signature ? row("Signature", '<span class="mono">' + esc(m.signature.alg) + '</span> <span class="dim">' + esc(m.signature.note || "") + "</span>") : "") +
        "</dl>" + (m.cart ? '<div class="r-head">Cart</div>' + orderBlock(m.cart) : "");
    }
    function settlementBlock(s) {
      return '<div class="r-head">✓ Settled via x402 on Hedera testnet</div><dl class="kv">' +
        row("Amount", esc(s.amountTinybar / 1e8) + ' ℏ <span class="dim">(' + esc(s.fxRate) + ")</span>") +
        row("From", esc(s.payer?.accountId) + ' <span class="dim">' + esc(s.payer?.kind) + "</span>") +
        row("To", esc(s.payTo)) +
        row("Tx", '<span class="mono">' + esc(s.txId) + '</span> · <a href="' + encodeURI(s.hashscanUrl) + '" target="_blank" rel="noopener">HashScan</a>') +
        "</dl>";
    }
    // Prefill from the gate receipt's hand-off, if present.
    try {
      const last = localStorage.getItem("pp:lastMandate");
      if (last) document.getElementById("input").value = last;
    } catch {}
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        const res = await fetch("/payment-gate/inspect/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: document.getElementById("input").value }),
        });
        const out = await res.json();
        let html = '<span class="kindtag">' + esc(out.kind) + "</span>";
        if (out.error) html += '<div class="gate fail err">✗ ' + esc(out.error) + "</div>";
        if (out.gates) html += "<div style=\\"margin-top:0.6rem;\\">" + out.gates.map((g) =>
          '<div class="gate ' + (g.pass ? "pass" : "fail") + '">' + (g.pass ? "✓" : "✗") + " " + esc(g.gate) + " — " + esc(g.detail) + "</div>").join("") + "</div>";
        if (out.mandate) html += mandateBlock(out.mandate);
        if (out.order) html += orderBlock(out.order);
        if (out.note) html += '<div class="note">' + esc(out.note) + "</div>";
        if (out.settlement) html += settlementBlock(out.settlement);
        el.innerHTML = html;
        el.style.display = "block";
      } catch (err) {
        el.innerHTML = '<div class="gate fail">✗ ' + esc(err?.message ?? String(err)) + "</div>";
        el.style.display = "block";
      } finally {
        btn.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}

export function registerInspectRoutes(app: Express): void {
  app.get("/payment-gate/inspect", (_req: Request, res: Response) => {
    res.status(200).type("html").send(renderInspectPage());
  });

  app.post("/payment-gate/inspect/validate", express.json({ limit: "1mb" }), async (req: Request, res: Response) => {
    const input = req.body?.input;
    if (typeof input !== "string") {
      res.status(400).json({ error: "input must be a string" });
      return;
    }
    if (input.length > MAX_INPUT_CHARS) {
      res.status(400).json({ error: "input too large" });
      return;
    }
    const origin = deriveOrigin({ headers: req.headers, host: req.get("host") ?? "localhost", protocol: req.protocol });
    res.json(await inspectArtifact(input, origin));
  });
}
