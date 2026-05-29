# Shopping Order Flow — Design

**Date:** 2026-05-28
**Status:** Approved (pending spec review)

## Problem

The product picker MCP app lets the user select products, but "confirming" does
nothing real. The `confirm-selection` tool computes a text summary and discards
it (despite its description claiming to "record" the order); the UI then injects
a synthetic user message listing the picks. There is no order, no persistence,
no confirmation. The app is meant to be a **real shopping flow**.

## Goals

- Clicking the confirm button **places a real order**: a persisted record with
  an ID and status.
- The user sees an **order confirmation in the picker UI**.
- The model is **notified of the placed order** so it can acknowledge in chat,
  grounded in real order data.
- Leave a **clean seam for a later payment phase** — no rework when payment is
  added.

## Non-goals (this phase)

- Payment / checkout / card entry. Explicitly a later phase.
- Durable persistence (database, file). In-memory only this phase.
- Model-initiated orders. Placing an order is a user action only.
- Querying/listing past orders, order history UI.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Flow scope | Place order, no payment | Payment is a later phase; design a seam for it |
| Persistence | In-memory store | Simplest; demo-appropriate. Orders lost on restart |
| Confirmation UX | In the picker UI + model notified | Richest, most app-like |
| Who can place orders | User button only | Safest; matters once real payment exists |
| Model notification | `updateModelContext` + brief `sendMessage` trigger | SDK-documented cart pattern; reply grounded in real order data, no bulky synthetic message |

## Architecture

Three layers, mirroring the existing pricing layering:

1. **Pure order-building** (`catalog.ts`) — `createOrder(items, id)` builds an
   `Order` from a priced cart. No storage, no side effects. Unit-testable like
   `priceCart`.
2. **Server store + tool** (`server.ts`) — a module-level `Map<string, Order>`
   and an app-only `place-order` tool that builds, stores, and returns the order.
3. **UI flow** (`src/app.tsx`) — the button calls `place-order`, then notifies
   the model (context + trigger) and switches to a confirmation view.

### 1. Data model & order-building — `catalog.ts`

```ts
export type OrderStatus = "placed"; // payment phase later adds "pending_payment" | "paid"

export interface Order {
  id: string;            // e.g. "ORD-1042"
  lines: PricedCartLine[];
  itemCount: number;
  total: number;
  currency: string;
  status: OrderStatus;
  createdAt: string;     // ISO timestamp
}

// Pure: builds an Order from cart items + an id. No storage, no side effects.
export function createOrder(items: CartItemInput[], id: string): Order;
```

`createOrder` reuses `priceCart` internally. The `id` is passed in (not
generated inside) so the function stays pure and deterministic for tests. The
`status` field is the payment seam: a future `pay-order` tool flips it from
`"placed"` to `"paid"` and nothing else in the data model changes.

### 2. Server: order store + `place-order` tool — `server.ts`

Module-level store, created once — **outside** `createServer()`, because the
HTTP path rebuilds the server per request (`main.ts:33`); state inside
`createServer()` would not survive across tool calls.

```ts
const orders = new Map<string, Order>();
let orderSeq = 1041;
function nextOrderId(): string { return `ORD-${++orderSeq}`; }
```

Replace the dead `confirm-selection` tool with `place-order`, marked app-only so
the model cannot place orders itself:

```ts
registerAppTool(server, "place-order", {
  title: "Place Order",
  description: "Place the user's selected cart as an order. Triggered by the UI only.",
  inputSchema: cartItemsSchema,
  _meta: { ui: { resourceUri: RESOURCE_URI, visibility: ["app"] } },
}, async ({ items }) => {
  const order = createOrder(items, nextOrderId());
  orders.set(order.id, order);
  return { content: [{ type: "text", text: JSON.stringify(order) }] };
});
```

The JSON result returns to the app (app-only tool), which uses it to render the
confirmation. `browse-products` and `price-cart` are unchanged.

**Known limitation (accepted):** in-memory orders are lost on restart and are
not shared across separate processes (stdio vs http run as different processes).

### 3. UI flow — `src/app.tsx`

`onConfirm` becomes `onPlaceOrder` in `HostApp`:

```ts
const onPlaceOrder = useCallback(async (cart) => {
  const items = cart.lines.map(l => ({ productId: l.id, quantity: l.quantity }));
  const result = await app.callServerTool({ name: "place-order", arguments: { items } });
  const order = parseJsonContent<Order>(result);
  await app.updateModelContext({ content: [{ type: "text", text: orderContextMarkdown(order) }] });
  await app.sendMessage({ role: "user", content: [{ type: "text", text: "I've placed my order." }] });
  return order;
}, [app]);
```

`Picker` gains a placed-order state. After `onPlaceOrder` resolves it renders an
`OrderConfirmation` view instead of the grid + footer:

- Order ID, status badge, line items (qty × name — line total), grand total.
- A "Start new order" button that clears the cart and returns to the grid.

Footer button renamed `"Add to chat"` → `"Place order"`.

`StandaloneApp` (plain browser, no host): builds the order locally via
`createOrder(items, "ORD-LOCAL")` and shows the same `OrderConfirmation` view.
No `updateModelContext` / `sendMessage` (no host bridge).

`orderContextMarkdown(order)` formats the order as a structured markdown block
(header fields + line items) — the form the SDK docs recommend for context.

## Data flow (place order)

```
User clicks "Place order"
  → app.callServerTool("place-order", { items })
      → server: createOrder → orders.set → returns Order JSON
  → app reads Order
  → app.updateModelContext(order markdown)   [silent; model sees on next turn]
  → app.sendMessage("I've placed my order.") [triggers model reply]
  → Picker renders OrderConfirmation(order)
Model replies in chat with confirmation, grounded in the order context.
```

## Error handling

- `place-order` with an empty/all-unknown cart: `createOrder` yields an order
  with no lines and a zero total — unknown ids are dropped (not added to lines),
  consistent with how `priceCart` excludes them from totals today. The `Order`
  shape intentionally omits an `unknownIds` field (it is not order data). UI
  disables "Place order" when `cart.itemCount === 0`, so an empty order is an
  edge guard, not a normal path.
- `callServerTool` rejection: caught in the click handler; the UI stays on the
  picker and logs the error (same pattern as the existing `priceCart` effect).

## Testing

Unit tests in `catalog.test.ts` for `createOrder` (mirrors `priceCart` tests):

- builds an order with correct lines, `itemCount`, `total`, `currency`
- `status` is `"placed"` and `createdAt` is set
- passed-in `id` is used verbatim
- empty / unknown-id carts behave consistently with `priceCart`

Not unit-tested (low value): the in-memory `Map` and the React confirmation
view. Verified manually via `npm run dev` (standalone) and `npm run build`.

## Docs

Update `README.md`: tool set is now `browse-products` / `price-cart` /
`place-order`; button is "Place order"; orders persist in-memory with an ID;
payment is a planned follow-up via `Order.status`.

## Future: payment phase (seam, not built now)

- Add `OrderStatus` values `"pending_payment"` / `"paid"`.
- `place-order` could create the order as `"pending_payment"`.
- New `pay-order` tool transitions to `"paid"` (mock or Stripe-test gateway).
- No change to `Order` shape or the store; confirmation view reads `status`.
