import { describe, it, expect } from "vitest";
import { deriveOrigin } from "./origin.js";

describe("deriveOrigin", () => {
  it("uses host + protocol for localhost dev", () => {
    expect(deriveOrigin({ headers: {}, host: "localhost:3001", protocol: "http" }))
      .toEqual({ rpID: "localhost", origin: "http://localhost:3001" });
  });

  it("strips the port from rpID but keeps it in origin", () => {
    expect(deriveOrigin({ headers: {}, host: "localhost:3001", protocol: "http" }).rpID)
      .toBe("localhost");
  });

  it("honors x-forwarded-host and x-forwarded-proto (Vercel)", () => {
    expect(deriveOrigin({
      headers: { "x-forwarded-host": "mcp-apps-nine.vercel.app", "x-forwarded-proto": "https" },
      host: "internal:3001",
      protocol: "http",
    })).toEqual({ rpID: "mcp-apps-nine.vercel.app", origin: "https://mcp-apps-nine.vercel.app" });
  });
});
