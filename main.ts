import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import type { Request, Response } from "express";
import { createServer } from "./server.js";
import { checkoutResponse, setCheckoutBaseUrl, startCheckoutHttpServer } from "./checkout.js";

async function startStdioServer(): Promise<void> {
  // stdio mode has no HTTP server of its own, but openLink needs a URL to open.
  // Start the mock checkout listener in the same process so it shares the cart/
  // order state with the stdio server.
  startCheckoutHttpServer();
  await createServer().connect(new StdioServerTransport());
}

async function startHttpServer(): Promise<void> {
  const port = parseInt(process.env.PORT ?? "3001", 10);

  // One origin serves both /mcp and the checkout page. PUBLIC_BASE_URL is the
  // externally reachable origin (e.g. the ngrok https URL) that both Claude and
  // ChatGPT connect to and that the checkout link must point at; it falls back
  // to localhost for local runs.
  const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`;
  setCheckoutBaseUrl(publicBaseUrl);

  const app = createMcpExpressApp({ host: "0.0.0.0" });
  app.use(cors());

  // Mock checkout page, same origin as /mcp so a single tunnel covers both.
  app.get("/checkout", (req: Request, res: Response) => {
    const order = typeof req.query.order === "string" ? req.query.order : undefined;
    const { status, html } = checkoutResponse(order);
    res.status(status).type("html").send(html);
  });

  // Allow the public tunnel host through the transport's DNS-rebinding guard.
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

  const httpServer = app.listen(port, () => {
    console.error(`MCP server listening on http://localhost:${port}/mcp`);
    console.error(`Checkout page on ${publicBaseUrl}/checkout`);
  });
  const shutdown = () => httpServer.close(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function main() {
  if (process.argv.includes("--stdio")) {
    await startStdioServer();
  } else {
    await startHttpServer();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
