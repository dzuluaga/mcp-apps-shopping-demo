// _meta key carrying the catalog from browse-products to the UI. Kept out of
// the tool's text content so the model doesn't re-render the list as a table.
export const CATALOG_META_KEY = "product-picker/catalog";

// _meta key carrying the current priced cart to the UI (app-only, out-of-band)
// so the model doesn't re-render it as text.
export const CART_META_KEY = "product-picker/cart";

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

export function getProduct(productId: string): Product | undefined {
  return CATALOG.find((p) => p.id === productId);
}

export interface Review {
  author: string;
  rating: number; // 1–5
  title: string;
  body: string;
}

// Sample reviews keyed by product id. Lets the model answer "what do people say
// about X?" without a real backend.
export const REVIEWS: Record<string, Review[]> = {
  "aurora-headphones": [
    { author: "Mia R.", rating: 5, title: "ANC is the real deal", body: "Cancels the office hum completely. Battery easily lasts a work week." },
    { author: "Devin K.", rating: 4, title: "Great, slightly tight", body: "Sound is rich and balanced. Clamp force is a bit strong on day one but loosens up." },
  ],
  "nimbus-keyboard": [
    { author: "Priya S.", rating: 5, title: "Hot-swap heaven", body: "Swapped to tactile switches in minutes, no soldering. PBT caps feel premium." },
    { author: "Tom B.", rating: 4, title: "Love it, wanted backlight", body: "Typing feel is excellent. Wish it had per-key RGB at this price." },
  ],
  "lumen-monitor": [
    { author: "Carlos M.", rating: 5, title: "USB-C one-cable setup", body: "Drives my laptop and charges it over one cable. Text is razor sharp at 4K." },
    { author: "Anna L.", rating: 4, title: "Beautiful panel", body: "Colors are great out of the box. Stand wobbles slightly if you bump the desk." },
  ],
  "drift-mouse": [
    { author: "Jordan P.", rating: 5, title: "Silent and light", body: "Clicks are nearly inaudible on calls. Glides effortlessly." },
    { author: "Sam W.", rating: 4, title: "Comfy for long days", body: "No wrist fatigue after 8 hours. Scroll wheel could be a touch grippier." },
  ],
  "pulse-webcam": [
    { author: "Lena F.", rating: 4, title: "Sharp 1080p60", body: "Smooth motion and the light correction handles my backlit window well." },
    { author: "Raj N.", rating: 4, title: "Solid upgrade", body: "Big step up from my laptop cam. Mic is okay; I still use a headset." },
  ],
  "harbor-dock": [
    { author: "Grace H.", rating: 5, title: "Replaced four adapters", body: "Dual HDMI, ethernet, and 100W passthrough all work flawlessly with my laptop." },
    { author: "Owen T.", rating: 4, title: "Runs a bit warm", body: "Does everything advertised. Gets warm under heavy load but never throttled." },
  ],
  "ember-desk-lamp": [
    { author: "Yuki A.", rating: 5, title: "Charges my phone too", body: "Tunable white is great for evenings and the Qi base is a clever touch." },
    { author: "Beth C.", rating: 4, title: "Nice and bright", body: "Plenty of light for reading. App could be simpler but the lamp is lovely." },
  ],
  "atlas-stand": [
    { author: "Marcus D.", rating: 5, title: "Rock solid", body: "No wobble even while typing hard. Folds flat for travel." },
    { author: "Iris V.", rating: 4, title: "Better posture instantly", body: "Raised my screen to eye level. Wish it went just a bit higher." },
  ],
};

export function getReviews(productId: string): Review[] {
  return REVIEWS[productId] ?? [];
}

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

// An order is a snapshot of the priced cart at checkout time. The demo does not
// take payment in chat: checkout hands off to an external (mock) merchant page,
// where the user completes the purchase with their own account.
export interface Order {
  id: string;
  lines: PricedCartLine[];
  itemCount: number;
  total: number;
  currency: string;
  createdAt: string;
}

// Snapshots cart items into an order. Unknown product ids are dropped (not
// validated).
export function createOrder(items: CartItemInput[], id: string): Order {
  const { lines, itemCount, total, currency } = priceCart(items);
  return { id, lines, itemCount, total, currency, createdAt: new Date().toISOString() };
}
