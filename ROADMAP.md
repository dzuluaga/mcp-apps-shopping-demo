# Roadmap

Planned work for the Product Picker MCP app. Status reflects intent, not a commitment.

## Now / next

- [x] **Try the product picker in ChatGPT.** Add `https://mcp-apps-nine.vercel.app/mcp`
  as a custom connector in ChatGPT (developer mode) and verify the widget renders
  and the cart/checkout flow works end to end via the `window.openai` bridge.
  Proof: <https://youtube.com/shorts/M-Vw3rCxNK0>. Verified across each surface:
  - [x] **ChatGPT web** (chatgpt.com in a browser) — the only surface that can
    *create* the connector (Settings → Connectors → Developer mode).
  - [x] **ChatGPT native mobile app** (iOS / Android) — consumes the connector
    added on web; check stepper touch targets and the checkout hand-off browser.
  - [x] **ChatGPT mobile web** (chatgpt.com in a phone browser) — check the
    responsive iframe reflow and whether `window.openai` is present.
- [x] **Incorporate the FIDO caBLE cross-device channel.** Added a
  "The cross-device channel (FIDO caBLE)" feature/section — integrated FIDO caBLE
  (cloud-assisted BLE) into the checkout hand-off flow.
  - [x] Passkey gate (same-device + cross-device caBLE) — `payment-gate/passkey/`.
  - [x] DC payment gate (cross-device caBLE, amount-bound) — `payment-gate/dc-payment/`.

## Demo & docs

- [ ] **Record demo video(s) across surfaces.** Walkthrough of the agentic flow
  (browse → edit cart conversationally → checkout hand-off) captured on multiple
  surfaces — mobile Claude native app, web (claude.ai), and the Claude Code
  terminal — for use in the README and presentation slides.
  - [x] **Claude native app** — <https://youtube.com/shorts/YiNzjIVcGOA>
  - [x] **ChatGPT** — <https://youtube.com/shorts/M-Vw3rCxNK0>
  - [x] **Web / Claude desktop (claude.ai)** — <https://youtu.be/MDlyOMIAgYg>
  - [ ] **Claude Code terminal**
- [ ] **Update R… (TBD).** Placeholder for an item that was truncated in chat
  ("Update R" — likely README or the router). Confirm scope before starting.
