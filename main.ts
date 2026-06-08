import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { startCheckoutHttpServer } from "./checkout.js";
import { createApp } from "./app.js";
import { startAp2Sidecar } from "./payment-gate/ap2Sidecar.js";

async function startStdioServer(): Promise<void> {
  // stdio mode has no HTTP server of its own, but openLink needs a URL to open.
  // Start the mock checkout listener in the same process so it shares the cart/
  // order state with the stdio server. The AP2 sidecar (the payment gates' SD-JWT
  // mandate service) is a separate process; spawn it here too.
  startCheckoutHttpServer();
  startAp2Sidecar();
  await createServer().connect(new StdioServerTransport());
}

async function startHttpServer(): Promise<void> {
  const port = parseInt(process.env.PORT ?? "3001", 10);
  const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`;
  const allowedHosts = process.env.ALLOWED_HOSTS?.split(",").map((h) => h.trim()).filter(Boolean);

  // Bring up the AP2 sidecar alongside the HTTP server so the payment gates work
  // out of the box. Set AP2_SIDECAR_SPAWN=0 to manage it yourself (npm run start:sidecar).
  startAp2Sidecar();

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
