import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { setCheckoutBaseUrl, startCheckoutHttpServer } from "./checkout.js";
import { createApp } from "./app.js";

async function startStdioServer(): Promise<void> {
  // stdio mode has no HTTP server of its own, but openLink needs a URL to open.
  // Start the mock checkout listener in the same process so it shares the cart/
  // order state with the stdio server.
  startCheckoutHttpServer();
  await createServer().connect(new StdioServerTransport());
}

async function startHttpServer(): Promise<void> {
  const port = parseInt(process.env.PORT ?? "3001", 10);

  // Local HTTP serves /mcp and /checkout from the same Express app on this port,
  // so the checkout link must point at this port (not checkout.ts's 3030 default).
  // PUBLIC_BASE_URL still wins when set (e.g. an ngrok https URL).
  const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`;
  setCheckoutBaseUrl(publicBaseUrl);

  const app = createApp();
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
