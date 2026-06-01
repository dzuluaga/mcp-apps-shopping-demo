import { createApp } from "../app.js";

// Vercel @vercel/node runtime: an exported Express app is used as the request
// handler. vercel.json rewrites every path here, so this one function serves
// both /mcp and /checkout. State (cart) is shared across invocations via the
// Redis-backed CartStore; orders are stateless (encoded in the checkout URL).
export default createApp();
