import { describe, it, expect } from "vitest";
import { buildRegistrationOptions } from "./verify.js";

const origin = { rpID: "localhost", origin: "http://localhost:3001" };

describe("buildRegistrationOptions cross-device", () => {
  it("does not constrain authenticator attachment by default (local Touch ID allowed)", async () => {
    const { options } = await buildRegistrationOptions(origin, "secret");
    expect(options.authenticatorSelection?.authenticatorAttachment).toBeUndefined();
  });

  it("forces cross-platform attachment when crossDevice is set (drives the caBLE QR path)", async () => {
    const { options } = await buildRegistrationOptions(origin, "secret", { crossDevice: true });
    expect(options.authenticatorSelection?.authenticatorAttachment).toBe("cross-platform");
  });
});
