import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { createApp } from "./app.js";

async function startStdioServer(): Promise<void> {
  // stdio mode has no HTTP server of its own, but openLink needs a URL to open.
  // Serve the FULL express app (checkout page + payment & credential gates +
  // /checkout/order-status and /checkout/verification-status) in the same
  // process so every link the widget opens resolves and shares cart/order/
  // verification state with the stdio server.
  const port = Number(process.env.CHECKOUT_PORT ?? 3030);
  const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`;
  createApp({ publicBaseUrl }).listen(port, () => {
    console.error(`Checkout + gates on ${publicBaseUrl}`);
  });
  await createServer().connect(new StdioServerTransport());
}

async function startHttpServer(): Promise<void> {
  const port = parseInt(process.env.PORT ?? "3001", 10);
  const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`;
  const allowedHosts = process.env.ALLOWED_HOSTS?.split(",").map((h) => h.trim()).filter(Boolean);

  const app = createApp({ publicBaseUrl, ...(allowedHosts ? { allowedHosts } : {}) });

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
