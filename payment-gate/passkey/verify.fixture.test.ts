import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { verifyPasskeyAssertion } from "./verify.js";

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "registration.json");
const hasFixture = existsSync(fixturePath);

describe.skipIf(!hasFixture)("verifyPasskeyAssertion (recorded fixture)", () => {
  const fx = hasFixture ? JSON.parse(readFileSync(fixturePath, "utf8")) : null;

  beforeAll(() => {
    // Freeze time to just after issuance so the challenge token has not expired.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(fx.capturedAt ?? Date.now()));
    process.env.GATE_SECRET = "fixture-secret";
  });
  afterAll(() => vi.useRealTimers());

  it("verifies the recorded registration and yields a verified authenticator", async () => {
    const auth = await verifyPasskeyAssertion({
      response: fx.response,
      challengeToken: fx.challengeToken,
      origin: fx.origin,
      secret: "fixture-secret",
    });
    expect(auth.userVerified).toBe(true);
    expect(auth.credentialID).toBeTruthy();
  });
});
