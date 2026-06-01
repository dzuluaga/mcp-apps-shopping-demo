import { createApp } from "../app.js";

// Vercel @vercel/node runtime: an exported Express app is used as the request
// handler. vercel.json rewrites every path here, so this one function serves
// both /mcp and /checkout. State (cart) is shared across invocations via the
// Redis-backed CartStore; orders are stateless (encoded in the checkout URL).
function resolvePublicBaseUrl(): string {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return `http://localhost:${process.env.PORT ?? "3001"}`;
}

export default createApp({ publicBaseUrl: resolvePublicBaseUrl() });
