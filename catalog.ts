// _meta key carrying the catalog from browse-products to the UI. Kept out of
// the tool's text content so the model doesn't re-render the list as a table.
export const CATALOG_META_KEY = "product-picker/catalog";

export interface Product {
  id: string;
  name: string;
  price: number;
  currency: string;
  image: string;
  category: string;
  description: string;
}

export interface CartItemInput {
  productId: string;
  quantity: number;
}

export interface PricedCartLine {
  id: string;
  name: string;
  unitPrice: number;
  currency: string;
  quantity: number;
  lineTotal: number;
}

export interface PricedCart {
  lines: PricedCartLine[];
  itemCount: number;
  total: number;
  currency: string;
  unknownIds: string[];
}

export const CATALOG: Product[] = [
  {
    id: "aurora-headphones",
    name: "Aurora Wireless Headphones",
    price: 199.0,
    currency: "USD",
    image: "https://picsum.photos/seed/aurora-headphones/400/300",
    category: "Audio",
    description: "Over-ear ANC headphones with 40h battery life.",
  },
  {
    id: "nimbus-keyboard",
    name: "Nimbus Mechanical Keyboard",
    price: 129.0,
    currency: "USD",
    image: "https://picsum.photos/seed/nimbus-keyboard/400/300",
    category: "Accessories",
    description: "Hot-swappable 75% keyboard with PBT keycaps.",
  },
  {
    id: "lumen-monitor",
    name: 'Lumen 27" 4K Monitor',
    price: 449.0,
    currency: "USD",
    image: "https://picsum.photos/seed/lumen-monitor/400/300",
    category: "Displays",
    description: "27-inch 4K IPS display with USB-C power delivery.",
  },
  {
    id: "drift-mouse",
    name: "Drift Ergonomic Mouse",
    price: 69.0,
    currency: "USD",
    image: "https://picsum.photos/seed/drift-mouse/400/300",
    category: "Accessories",
    description: "Lightweight wireless mouse with silent clicks.",
  },
  {
    id: "pulse-webcam",
    name: "Pulse 1080p Webcam",
    price: 89.0,
    currency: "USD",
    image: "https://picsum.photos/seed/pulse-webcam/400/300",
    category: "Video",
    description: "1080p60 webcam with auto light correction.",
  },
  {
    id: "harbor-dock",
    name: "Harbor USB-C Dock",
    price: 159.0,
    currency: "USD",
    image: "https://picsum.photos/seed/harbor-dock/400/300",
    category: "Accessories",
    description: "11-in-1 dock: dual HDMI, Ethernet, SD, 100W passthrough.",
  },
  {
    id: "ember-desk-lamp",
    name: "Ember Smart Desk Lamp",
    price: 59.0,
    currency: "USD",
    image: "https://picsum.photos/seed/ember-desk-lamp/400/300",
    category: "Lighting",
    description: "Tunable white LED lamp with wireless charging base.",
  },
  {
    id: "atlas-stand",
    name: "Atlas Laptop Stand",
    price: 49.0,
    currency: "USD",
    image: "https://picsum.photos/seed/atlas-stand/400/300",
    category: "Accessories",
    description: "Aluminum adjustable laptop stand, folds flat.",
  },
];

export function priceCart(items: CartItemInput[]): PricedCart {
  const byId = new Map(CATALOG.map((p) => [p.id, p]));
  const lines: PricedCartLine[] = [];
  const unknownIds: string[] = [];
  for (const { productId, quantity } of items) {
    const product = byId.get(productId);
    if (!product) {
      unknownIds.push(productId);
      continue;
    }
    if (quantity <= 0) continue;
    lines.push({
      id: product.id,
      name: product.name,
      unitPrice: product.price,
      currency: product.currency,
      quantity,
      lineTotal: product.price * quantity,
    });
  }
  const itemCount = lines.reduce((sum, l) => sum + l.quantity, 0);
  const total = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  const currency = lines[0]?.currency ?? "USD";
  return { lines, itemCount, total, currency, unknownIds };
}

export type OrderStatus = "placed"; // payment phase later adds "pending_payment" | "paid"

export interface Order {
  id: string;
  lines: PricedCartLine[];
  itemCount: number;
  total: number;
  currency: string;
  status: OrderStatus;
  createdAt: string;
}

// Builds an Order from cart items. Unknown product ids are dropped (not validated).
export function createOrder(items: CartItemInput[], id: string): Order {
  const { lines, itemCount, total, currency } = priceCart(items);
  return {
    id,
    lines,
    itemCount,
    total,
    currency,
    status: "placed",
    createdAt: new Date().toISOString(),
  };
}
