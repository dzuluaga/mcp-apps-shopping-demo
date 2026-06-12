import { describe, it, expect } from "vitest";
import { createOrder } from "../../catalog.js";
import { encodeOrder } from "../../checkout.js";
import { renderPasskeyPage } from "./page.js";

describe("passkey page settlement beat", () => {
  it("ships the settling-status and settlement-render hooks to the client", () => {
    const order = createOrder([{ productId: "drift-mouse", quantity: 1 }], "ORD-PG1");
    const html = renderPasskeyPage({ order, orderToken: encodeOrder(order) });
    // The client script must show an honest in-flight state and render both
    // terminal settlement states from the verify response.
    expect(html).toContain("Settling via x402 on Hedera testnet");
    expect(html).toContain("Settled via x402 on Hedera testnet");
    expect(html).toContain("out.settlement");
    expect(html).toContain("out.settlementError");
    expect(html).toContain("authorized, not settled");
    expect(html).toContain("HashScan");
    // The settled line shows the actual on-chain amount, derived from tinybar.
    expect(html).toContain("amountTinybar / 1e8");
    // Structured receipt: gates collapse to a summary; settlement is a
    // labeled card naming both parties, honest per payer kind.
    expect(html).toContain("authorization gates passed");
    expect(html).toContain("details");
    expect(html).toContain('"kv"');
    expect(html).toContain("demo customer");
    expect(html).toContain("merchant");
    expect(html).toContain("wallet created for this order");
    // Indeterminate progress bar while the verify+settle round trip runs
    // (mint + transfer are two consensus rounds, ~6-10s) — set expectations.
    expect(html).toContain('id="bar"');
    expect(html).toContain("can take ~10s");
    expect(html).toContain("bar.classList.add");
    expect(html).toContain("bar.classList.remove");
    // Honest demo framing: the on-chain amount is a tiny pegged amount, not
    // the dollar total — stated in the side explainer so the receipt can't
    // mislead, while the main column stays one short line.
    expect(html).toContain("tiny token amount");
    expect(html).toContain("How this payment works");
    expect(html).toContain('class="cols"');
    expect(html).toContain("settledInMs");
    expect(html).toContain("walletAgeMs");
    expect(html).toContain("old when it paid");
    // The gate page must not be a dead end: a way back to the checkout page
    // (where loyalty/age status lives) both before and after completion.
    expect(html).toContain("Back to checkout");
    expect(html).toContain("/checkout?order=");
    expect(html).toContain("checkoutUrl");
    // Scannable proof: the settled receipt embeds a QR to the HashScan tx.
    expect(html).toContain("/payment-gate/qr?data=");
    expect(html).toContain("Scan to verify on HashScan");
    expect(html).toContain("esc(out.settlementError)");
    // Receipt hands the mandate to the inspector.
    expect(html).toContain("pp:lastMandate");
    expect(html).toContain("/payment-gate/inspect");
    expect(html).toContain("esc(s.txId)");
    expect(html).toContain("esc(g.gate)");
    expect(html).toContain("esc(g.detail)");
    expect(html).toContain("esc(out.mandate.id)");
  });
});
