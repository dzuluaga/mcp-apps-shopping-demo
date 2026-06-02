import { describe, it, expect } from "vitest";
import { renderPasskeyPage } from "./page.js";
import type { Order } from "../../catalog.js";

const order: Order = {
  id: "ORD-PAGE01",
  lines: [{ id: "drift-mouse", name: "Drift Ergonomic Mouse", unitPrice: 69, currency: "USD", quantity: 1, lineTotal: 69 }],
  itemCount: 1,
  total: 69,
  currency: "USD",
  createdAt: "2026-05-31T00:00:00.000Z",
};

describe("renderPasskeyPage", () => {
  it("shows the amount being authorized and the order id", () => {
    const html = renderPasskeyPage({ order, orderToken: "TOKEN123" });
    expect(html).toContain("$69.00");
    expect(html).toContain("ORD-PAGE01");
  });

  it("loads the WebAuthn browser ESM from a same-origin path (no CDN)", () => {
    const html = renderPasskeyPage({ order, orderToken: "TOKEN123" });
    expect(html).toContain('from "/payment-gate/lib/sw/index.js"');
    expect(html).not.toContain("https://unpkg.com");
  });

  it("embeds the order token so the client posts it back", () => {
    const html = renderPasskeyPage({ order, orderToken: "TOKEN123" });
    expect(html).toContain("TOKEN123");
  });

  it("escapes order field values", () => {
    const evil = { ...order, id: '"><script>x()</script>' };
    const html = renderPasskeyPage({ order: evil, orderToken: "T" });
    expect(html).not.toContain("<script>x()</script>");
  });

  it("fetches local options and offers a switch to phone (caBLE) by default", () => {
    const html = renderPasskeyPage({ order, orderToken: "TOKEN123" });
    expect(html).toContain('"/payment-gate/passkey/options"');
    expect(html).toContain("order=TOKEN123&amp;xdev=1");
  });

  it("in cross-device mode fetches the xdev options and offers a switch back to this device", () => {
    const html = renderPasskeyPage({ order, orderToken: "TOKEN123", crossDevice: true });
    expect(html).toContain("/payment-gate/passkey/options?xdev=1");
    expect(html).toContain('href="/payment-gate/passkey?order=TOKEN123"');
  });
});
