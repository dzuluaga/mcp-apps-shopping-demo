import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import type { Express, Request, Response } from "express";
import { createServer } from "./server.js";
import { checkoutResponse } from "./checkout.js";

// Builds the Express app that serves both /mcp and the mock /checkout page from
// one origin. Pure construction, no listen() — main.ts listens locally and the
// Vercel function entrypoint exports the app directly. The checkout base URL is
// resolved in checkout.ts (PUBLIC_BASE_URL / VERCEL_PROJECT_PRODUCTION_URL /
// localhost); main.ts overrides it for local HTTP runs to point at the MCP port.
export function createApp(): Express {
  const app = createMcpExpressApp({ host: "0.0.0.0" });
  app.use(cors());

  // Mock checkout page, same origin as /mcp so a single tunnel/deploy covers both.
  app.get("/checkout", (req: Request, res: Response) => {
    const order = typeof req.query.order === "string" ? req.query.order : undefined;
    const { status, html } = checkoutResponse(order);
    res.status(status).type("html").send(html);
  });

  // Allow the public tunnel/deploy host through the transport's DNS-rebinding guard.
  const allowedHosts = process.env.ALLOWED_HOSTS?.split(",").map((h) => h.trim()).filter(Boolean);

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

  return app;
}
