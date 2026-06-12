// SVG QR endpoint for the settlement receipt: lets the audience scan straight
// to the HashScan transaction from a phone — third-party verification without
// trusting the demo screen. Rendered server-side (no CDN, repo convention) and
// locked to HashScan URLs so it cannot be repurposed as a QR generator for
// arbitrary (phishing) links.
import type { Express, Request, Response } from "express";
import QRCode from "qrcode";

const ALLOWED_PREFIX = "https://hashscan.io/";

// Raw base64 PNG (no data-URI prefix) for MCP image content blocks, so the
// agent's order confirmation can carry a scannable QR into the chat itself.
export async function qrPngBase64(data: string): Promise<string> {
  const dataUri = await QRCode.toDataURL(data, { margin: 1, width: 240 });
  return dataUri.split(",")[1];
}

export function registerQrRoute(app: Express): void {
  app.get("/payment-gate/qr", async (req: Request, res: Response) => {
    const data = typeof req.query.data === "string" ? req.query.data : undefined;
    if (!data || !data.startsWith(ALLOWED_PREFIX)) {
      res.status(400).json({ error: "data must be a hashscan.io URL" });
      return;
    }
    try {
      const svg = await QRCode.toString(data, { type: "svg", margin: 1, width: 240 });
      res.status(200).type("image/svg+xml").send(svg);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });
}
