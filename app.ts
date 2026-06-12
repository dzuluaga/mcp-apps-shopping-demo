import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import type { Express, Request, Response } from "express";
import { createServer } from "./server.js";
import { checkoutResponse, decodeOrder, demoCompletedOrder, isAgeUnverified, setCheckoutBaseUrl } from "./checkout.js";
import { orderStore } from "./orderStore.js";
import { cartStore } from "./cartStore.js";
import { registerPasskeyGate } from "./payment-gate/passkey/routes.js";
import { registerDcPaymentGate } from "./payment-gate/dc-payment/routes.js";
import { registerQrRoute } from "./payment-gate/qr.js";
import { registerCredentialGate } from "./payment-gate/credential-gate/routes.js";
import { verificationStore } from "./verificationStore.js";

export interface AppOptions {
  publicBaseUrl: string;
  allowedHosts?: string[];
}

export function createApp({ publicBaseUrl, allowedHosts }: AppOptions): Express {
  setCheckoutBaseUrl(publicBaseUrl);

  const app = createMcpExpressApp({ host: "0.0.0.0" });
  app.use(cors());

  app.get("/checkout", async (req: Request, res: Response) => {
    const token = typeof req.query.order === "string" ? req.query.order : undefined;
    // Age verification + loyalty happen on this page (end of flow). Read the
    // verification scoped to THIS order so one shopper's state never leaks into
    // another's checkout.
    const decoded = token ? decodeOrder(token) : undefined;
    const v = decoded
      ? await verificationStore.read(decoded.id)
      : { ageVerified: false, loyalty: { applied: false, membershipNumber: null } };
    // A revisited checkout for an already-completed order shows the paid state
    // (checkoutResponse matches on orderId) instead of re-offering payment.
    const completed = decoded ? await orderStore.read() : null;
    const { status, html } = checkoutResponse(
      token,
      { ageVerified: v.ageVerified, loyaltyApplied: v.loyalty.applied },
      completed,
    );
    res.status(status).type("html").send(html);
  });

  // Same-origin completion poll for the embedded widget. The payment gate writes
  // the order to the shared store; the widget polls this after handing off and,
  // on completion, injects a user-turn message so the agent confirms in chat.
  // Read-only — the agent never drives this; the browser does.
  app.get("/checkout/order-status", async (req: Request, res: Response) => {
    const orderId = typeof req.query.orderId === "string" ? req.query.orderId : undefined;
    const order = await orderStore.read();
    const completed = !!order && (!orderId || order.orderId === orderId);
    res.json({ completed, order: completed ? order : null });
  });

  // Instant-demo completion: the checkout page's "Place order" button POSTs the
  // order token here. We record a demo CompletedOrder (no device authorization)
  // and clear the cart, mirroring what the payment gates do on success. The
  // embedded widget's order-status poll then sees completion and confirms in chat.
  app.post("/checkout/place-order", async (req: Request, res: Response) => {
    const token = typeof req.body?.order === "string" ? req.body.order : undefined;
    const decoded = token ? decodeOrder(token) : undefined;
    const order = token ? demoCompletedOrder(token) : null;
    if (!order || !decoded) {
      res.status(400).json({ ok: false, error: "Invalid or missing order token." });
      return;
    }
    // Server-side age gate — the page lock is render-only and a direct POST
    // would otherwise bypass it.
    if (await isAgeUnverified(decoded)) {
      res.status(403).json({ ok: false, error: "Age verification required for this order." });
      return;
    }
    await orderStore.write(order);
    await cartStore.write(new Map());
    // Completed purchase: clear this order's verification.
    await verificationStore.clear(order.orderId);
    res.json({ ok: true, orderId: order.orderId });
  });

  app.all("/mcp", async (req: Request, res: Response) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      ...(allowedHosts ? { enableDnsRebindingProtection: true, allowedHosts } : {}),
    });
    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  registerPasskeyGate(app);
  registerDcPaymentGate(app);
  registerQrRoute(app);
  registerCredentialGate(app);

  return app;
}
