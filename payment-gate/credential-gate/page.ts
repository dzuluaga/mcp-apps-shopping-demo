// Server-rendered credential gate page (age or loyalty). Runs
// navigator.credentials.get({digital}) with the server's signed request and
// POSTs the encrypted response to /verify. Falls back to an instant-demo button
// (POST /demo) when the Digital Credentials API is unavailable. Styled like the
// dc-payment gate.
export type CredentialKind = "age" | "loyalty";

interface PageArgs {
  kind: CredentialKind;
  order?: string; // optional order token, echoed back so the widget can resume
}

const COPY: Record<CredentialKind, { title: string; lede: string; cta: string; demo: string }> = {
  age: {
    title: "Verify your age (21+)",
    lede: "Your cart contains age-restricted items. Present a digital ID (mobile driver's license) so we can confirm you're 21 or older. Nothing is stored — only an over-21 check.",
    cta: "Verify with my digital ID",
    demo: "Verify age (instant demo)",
  },
  loyalty: {
    title: "Apply loyalty discount",
    lede: "Present your loyalty membership credential to take 10% off your whole cart. Optional — your purchase works without it.",
    cta: "Present loyalty credential",
    demo: "Apply loyalty (instant demo)",
  },
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderCredentialPage(args: PageArgs): string {
  const { kind } = args;
  const order = args.order ? escapeHtml(args.order) : "";
  const c = COPY[kind];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(c.title)}</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 560px; margin: 3rem auto; padding: 0 1.25rem; color: #1a1a1a; }
  h1 { font-size: 1.35rem; margin-bottom: 0.25rem; }
  p.lede { color: #555; margin-top: 0; line-height: 1.45; }
  button { font-size: 1rem; padding: 0.75rem 1.1rem; border-radius: 6px; border: 1px solid #1a7f37; background: #1a7f37; color: #fff; cursor: pointer; width: 100%; margin-top: 0.75rem; }
  button.secondary { background: #fff; color: #1a7f37; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .step { padding: 0.4rem 0; font-family: ui-monospace, Menlo, monospace; font-size: 0.85rem; }
  .step.ok { color: #0a7f2e; } .step.err { color: #b00020; white-space: pre-wrap; }
  .notice { margin-top: 1rem; padding: 0.9rem 1rem; background: #fff7ed; border-left: 4px solid #d97706; border-radius: 6px; font-size: 0.9rem; }
  #done { display:none; margin-top:1.25rem; background:#0a7f2e; color:#fff; font-size:1.1rem; font-weight:700; padding:1rem 1.1rem; border-radius:8px; text-align:center; }
</style>
</head>
<body>
  <h1>${escapeHtml(c.title)}</h1>
  <p class="lede">${escapeHtml(c.lede)}</p>
  <button id="go">${escapeHtml(c.cta)}</button>
  <button id="demo" class="secondary">${escapeHtml(c.demo)}</button>
  <div id="log"></div>
  <div id="done">✓ Done — you can close this page and return to the chat.</div>
  <script type="module">
    const KIND = ${JSON.stringify(kind)};
    const ORDER = ${JSON.stringify(order)};
    const base = "/credential-gate/" + KIND;
    const log = document.getElementById("log");
    const go = document.getElementById("go");
    const demo = document.getElementById("demo");
    const doneEl = document.getElementById("done");
    const step = (t, c = "") => { const d = document.createElement("div"); d.className = "step " + c; d.textContent = t; log.appendChild(d); };
    function notice(html) { const d = document.createElement("div"); d.className = "notice"; d.innerHTML = html; log.appendChild(d); }
    function done() {
      go.disabled = true; demo.disabled = true;
      if (ORDER) { window.location.href = "/checkout?order=" + encodeURIComponent(ORDER); return; }
      doneEl.style.display = "block";
    }

    go.addEventListener("click", async () => {
      go.disabled = true;
      if (!("credentials" in navigator) || !window.DigitalCredential) {
        notice("This browser doesn't support <code>navigator.credentials.get({digital})</code> (need <strong>Chrome 141+</strong>). Use the instant-demo button below.");
        go.disabled = false;
        return;
      }
      try {
        step("→ GET signed request");
        const { request, readerContextToken } = await fetch(base + "/request").then((r) => r.json());
        step("→ navigator.credentials.get({digital}) — Chrome should show a QR…");
        const result = await navigator.credentials.get({ digital: { requests: [{ protocol: "openid4vp-v1-signed", data: { request } }] }, mediation: "required" });
        let data = result?.data ?? null;
        if (typeof data === "string") { try { data = JSON.parse(data); } catch {} }
        step("→ verify");
        const out = await fetch(base + "/verify", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ readerContextToken, order: ORDER, result: { protocol: result?.protocol ?? null, data } }),
        }).then((r) => r.json());
        if (!out.verified) throw new Error(out.error || "not verified");
        step("✓ verified", "ok");
        done();
      } catch (err) {
        step("✗ " + (err?.message ?? String(err)), "err");
        go.disabled = false;
      }
    });

    demo.addEventListener("click", async () => {
      demo.disabled = true;
      try {
        const out = await fetch(base + "/demo", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order: ORDER }),
        }).then((r) => r.json());
        if (!out.verified) throw new Error("demo failed");
        step("✓ verified (instant demo)", "ok");
        done();
      } catch (err) {
        step("✗ " + (err?.message ?? String(err)), "err");
        demo.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}
