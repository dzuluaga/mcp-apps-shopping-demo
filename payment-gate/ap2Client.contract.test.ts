// TS <-> AP2 sidecar contract test. Spawns the real Python sidecar (the vendored
// AP2 SDK) and drives the actual `ap2Client` over HTTP — no mocks — so the wire
// contract (camelCase order, {gate,pass,detail} gates, minor-units conversion)
// is exercised end to end across the language boundary.
//
// Skipped when the sidecar venv isn't present (e.g. CI without Python), mirroring
// verify.fixture.test.ts. To run it: `cd ap2-sidecar && python3 -m venv .venv &&
// .venv/bin/pip install -e ".[dev]"`.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildMandate, verifyMandate } from "./ap2Client.js";
import { createOrder } from "../catalog.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SIDECAR_DIR = path.join(HERE, "..", "ap2-sidecar");
const VENV_PY = path.join(SIDECAR_DIR, ".venv", "bin", "python");
const PORT = 8791;
const hasSidecar = existsSync(VENV_PY) && existsSync(path.join(SIDECAR_DIR, "app.py"));

let child: ChildProcess | undefined;

async function waitForHealth(url: string, tries = 60): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

describe.skipIf(!hasSidecar)("ap2Client <-> sidecar contract", () => {
  const order = createOrder([{ productId: "lumen-monitor", quantity: 1 }], "ORD-CONTRACT"); // $449
  const payeeId = "did:web:product-picker.local";

  beforeAll(async () => {
    process.env.AP2_SIDECAR_URL = `http://127.0.0.1:${PORT}`;
    child = spawn(VENV_PY, ["-m", "uvicorn", "app:app", "--port", String(PORT), "--log-level", "warning"], {
      cwd: SIDECAR_DIR,
      stdio: "ignore",
    });
    if (!(await waitForHealth(`http://127.0.0.1:${PORT}/healthz`))) {
      throw new Error("AP2 sidecar did not become healthy");
    }
  }, 30_000);

  afterAll(() => {
    child?.kill();
    delete process.env.AP2_SIDECAR_URL;
  });

  it("passkey: build -> verify, all gates pass", async () => {
    const built = await buildMandate({
      order,
      channel: "passkey",
      authorization: { type: "webauthn.assertion", credentialId: "cred-c", userVerified: true },
      payeeId,
    });
    expect(built.mandateId).toMatch(/^mandate_pm_/);
    expect(built.mandate.split(".").length).toBeGreaterThanOrEqual(3); // a JWT

    const v = await verifyMandate({ mandate: built.mandate, expectedAmount: order.total, expectedCurrency: order.currency, expectedPayeeId: payeeId });
    expect(v.valid).toBe(true);
    expect(v.gates.find((g) => g.gate === "signature")?.pass).toBe(true);
    expect(v.gates.every((g) => g.pass)).toBe(true);
    // dollars -> minor units happened inside the sidecar
    expect((v.payload?.payment_amount as { amount: number }).amount).toBe(44900);
  });

  it("dc: build -> verify with attested amount binding, all gates pass", async () => {
    const built = await buildMandate({
      order,
      channel: "dc",
      authorization: {
        type: "openid4vp-dc-api",
        instrumentId: "instr-c",
        authBlocksPresent: true,
        transactionDataHash: "h",
        amountBound: true,
        bindingDetail: "hash ✓",
        credentialExpiry: 9999999999,
      },
      payeeId,
    });
    const v = await verifyMandate({ mandate: built.mandate, expectedAmount: order.total, expectedCurrency: order.currency, expectedPayeeId: payeeId });
    expect(v.valid).toBe(true);
    expect(v.gates.find((g) => g.gate === "amount_signature_bound")?.pass).toBe(true);
  });

  it("tampered amount is rejected by the sidecar's amount_integrity gate", async () => {
    const built = await buildMandate({ order, channel: "passkey", authorization: { credentialId: "cred-c", userVerified: true }, payeeId });
    const v = await verifyMandate({ mandate: built.mandate, expectedAmount: order.total + 100, expectedCurrency: order.currency, expectedPayeeId: payeeId });
    expect(v.valid).toBe(false);
    expect(v.gates.find((g) => g.gate === "amount_integrity")?.pass).toBe(false);
  });
});
