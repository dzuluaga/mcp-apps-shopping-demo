import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import type { Express, Request, Response } from "express";
import { createServer } from "./server.js";
import { checkoutResponse, setCheckoutBaseUrl } from "./checkout.js";
import { registerPasskeyGate } from "./payment-gate/passkey/routes.js";
import { registerDcPaymentGate } from "./payment-gate/dc-payment/routes.js";

export interface AppOptions {
  publicBaseUrl: string;
  allowedHosts?: string[];
}

export function createApp({ publicBaseUrl, allowedHosts }: AppOptions): Express {
  setCheckoutBaseUrl(publicBaseUrl);

  const app = createMcpExpressApp({ host: "0.0.0.0" });
  app.use(cors());

  app.get("/checkout", (req: Request, res: Response) => {
    const order = typeof req.query.order === "string" ? req.query.order : undefined;
    const { status, html } = checkoutResponse(order);
    res.status(status).type("html").send(html);
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

  return app;
}
