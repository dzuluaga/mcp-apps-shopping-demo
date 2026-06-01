# Checkout Hand-off + Cart Inspection — Design

**Date:** 2026-05-29
**Status:** Approved (design); pending spec review before planning.

## Goal

Make the product-picker demo behave like the real Claude/Gemini + Instacart
pattern: the agent builds and edits the cart conversationally, but **does not
place orders or take payment**. Checkout is a hand-off to an external (mock)
merchant page. Cart inspection and item removal become first-class, advertised
capabilities.

## Motivation

Two reference videos (captured in `docs/instacart-demo-notes.md` and
`docs/instacart-gemini-demo-notes.md`) show the idiomatic shape across both
Claude and Gemini:

- Conversation-first; the widget is a thin cart surface.
- Edits work from **both** chat and the widget (bidirectional).
- A visible **capability contract** (Gemini lists what the agent CAN / CANNOT do).
- The agent **refuses to check out** — it opens the merchant's checkout in a
  browser tab; the user completes payment with their own account.
- **No payment is collected in chat.**

The current demo diverges: it collects a shipping address and runs a mock
`pay-order` inside the conversation. This spec removes that and replaces it with
a hand-off, and promotes cart read/remove to advertised tools.

## Scope

### In scope
1. Remove in-chat checkout simulation: `set-shipping`, `place-order`, `pay-order`
   tools and the `ShippingAddress` / `pending_payment` / `paid` / `paidAt`
   order lifecycle.
2. Add a `checkout` tool (UI-linked) that snapshots the current cart into an
   order and returns `{ orderId, checkoutUrl }`. Does **not** clear the cart.
3. Serve a mock checkout HTML page over HTTP, including in **stdio** mode (a
   small listener started in the same process so it shares cart/order state):
   `GET /checkout?order=ORD-xxxx` → page showing the order line items + total +
   a mock "Place order" button (client-side confirmation only; no charge).
4. Add a **Checkout** button to the widget footer (visible when the cart is
   non-empty): `callServerTool("checkout")` → `openLink(checkoutUrl)`.
5. Add a **capability contract** to the `browse-products` intro text:
   - CAN: browse, search/show details & reviews, read the cart, change
     quantities, add items, remove items.
   - CANNOT: place orders, take payment (checkout happens on the merchant page).
6. Add an explicit `remove-from-cart` tool (UI-linked, by `productId`) as a
   clear-intent alias for removal. `get-cart` stays for inspection.

### Out of scope
- Real payment / real merchant integration.
- OAuth / account-connector step (noted as a future idea; not built here).
- Persisting orders across restarts (still in-memory).
- Multi-user / per-conversation carts (still demo-global).

## Architecture

Unchanged core: thin selection widget (iframe) + agent orchestration via tools,
sharing one server-side cart. The change is at the end of the flow.

```
select in widget ──Add──▶ server cart updates ──▶ widget badge + model context
                                  │
   agent (chat): get-cart, add-to-cart, set-quantity, remove-from-cart
                                  │
        user clicks "Checkout" in widget
                                  │
        checkout tool: cart ─snapshot─▶ order, returns { orderId, checkoutUrl }
                                  │
        widget: openLink(checkoutUrl)
                                  │
        browser tab: GET /checkout?order=ORD-xxxx  (mock "Place order")
```

### Components

- **`catalog.ts`** — simplify the order model: an `Order` is a snapshot of priced
  cart lines + id + total + currency + `createdAt`. Drop `status`, `paidAt`,
  `shipping`, `ShippingAddress`, `OrderStatus`. `createOrder(items, id)` keeps its
  two-arg form.
- **Checkout HTTP page** — a small module that owns the in-memory `orders` map and
  exposes:
  - a way to create/store an order from priced cart lines and get its id,
  - an Express (or http) handler for `GET /checkout?order=ID` returning the HTML,
  - `startCheckoutHttpServer(port)` used by the stdio entrypoint; the same route
    is also mountable on the existing HTTP entrypoint.
  The page is server-rendered HTML (no bundler); the "Place order" button does a
  client-side confirmation (e.g. swaps to "Order placed (demo)"). No real charge.
- **`server.ts`** — drop the three checkout tools; add `checkout` (UI-linked,
  no input) and `remove-from-cart` (UI-linked, `{ productId }`). `checkout`
  errors if the cart is empty; otherwise creates an order and returns
  `{ orderId, checkoutUrl }` as JSON. The base URL comes from the checkout
  server module. Update the `browse-products` intro to the capability contract.
- **`main.ts`** — in `startStdioServer`, also start the checkout HTTP listener so
  `openLink` has something to open. In `startHttpServer`, mount the same
  `/checkout` route alongside `/mcp`.
- **`src/app.tsx`** — add a **Checkout** button in the footer (cart non-empty).
  Handler: `callServerTool("checkout")` → parse `{ checkoutUrl }` → `openLink`.
  Standalone mode has no host/openLink, so the button is disabled (or hidden)
  there. Keep `remove-from-cart` results flowing through `ontoolresult` like the
  other cart tools.
- **`src/app.module.css`** — style for the Checkout button (reuse `.confirm` or a
  sibling class).

### Tool inventory (after)

UI-linked (model + widget): `browse-products`, `add-to-cart`, `set-quantity`,
`remove-from-cart`, `get-cart`, `checkout`.
Model-only: `get-product-details`, `get-product-reviews`.
Removed: `set-shipping`, `place-order`, `pay-order`.

## Data flow / state

- Server-side `cart: Map<productId, qty>` — unchanged; single source of truth.
- `orders: Map<orderId, Order>` — moves to the checkout module; created by
  `checkout`; read by `GET /checkout`.
- `checkout` does **not** clear the cart (the page is the terminal step; clearing
  would empty the widget badge mid-flow).

## Error handling

- `checkout` with empty cart → `isError` result with a message telling the agent
  to add items first.
- `GET /checkout?order=ID` with unknown/missing id → simple 404 HTML page.
- `remove-from-cart` with unknown id → return the (unchanged) priced cart; no
  error needed (idempotent removal).
- Standalone widget: Checkout button disabled (no MCP host / `openLink`).

## Testing

- `catalog.test.ts` — update `createOrder` tests: drop shipping/status/paidAt
  assertions; keep id/lines/itemCount/total/currency/createdAt. Keep `priceCart`,
  `getProduct`, `getReviews` tests as-is.
- New: checkout-page render test — given an order, the HTML contains each line
  item name, the total, and a "Place order" control; unknown id → 404.
- New: `checkout` tool — empty cart → isError; non-empty → returns a URL
  containing the created order id, and the order is retrievable from the store.
- (UI is verified manually in the host; note that explicitly — automated UI
  testing is out of scope.)

## Decisions carried / deferred

- **Add-to-cart hand-off** stays as **#2 (short nudge: "Added these to my cart.")**
  per the earlier explicit choice. The videos argue for #1 (silent); revisit only
  if desired. Not changed by this spec.
- **Checkout port** defaults to `3030` (override via env), separate from the
  `/mcp` HTTP port (`3001`) so both can run.
- Account/connector + visible CAN/CANNOT *UI panel* (vs. text) are future work.
