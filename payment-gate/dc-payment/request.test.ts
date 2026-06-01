import { describe, it, expect } from "vitest";
import * as jose from "jose";
import { createOrder } from "../../catalog.js";
import { buildSignedRequest } from "./request.js";
import { openReaderContext } from "./readerContext.js";

const secret = "test-gate-secret";

describe("buildSignedRequest", () => {
  it("returns a signed request JWT bound to the order amount, and a sealed reader context", async () => {
    const order = createOrder([{ productId: "drift-mouse", quantity: 2 }], "ORD-REQ01");
    const origin = { rpID: "localhost", origin: "http://localhost:3030" };
    const { request, readerContextToken } = await buildSignedRequest(order, origin, secret);

    // The JWT is signed; we only decode (no trust check) to assert its shape.
    const claims = jose.decodeJwt(request) as any;
    expect(claims.response_type).toBe("vp_token");
    expect(claims.client_id).toBe("x509_san_dns:localhost");
    expect(claims.expected_origins).toEqual(["http://localhost:3030"]);
    expect(Array.isArray(claims.transaction_data)).toBe(true);
    expect(claims.transaction_data).toHaveLength(1);

    const header = jose.decodeProtectedHeader(request);
    expect(header.alg).toBe("ES256");
    expect(Array.isArray((header as any).x5c)).toBe(true);

    // The sealed context decrypts and carries the same transaction_data we sent.
    const ctx = await openReaderContext(readerContextToken, secret);
    expect(ctx.transactionDataB64).toBe(claims.transaction_data[0]);
    expect(ctx.ecdhPrivateJwk.crv).toBe("P-256");
    expect(ctx.ecdhPrivateJwk.d).toBeTruthy();
  });

  it("derives the client_id SAN from the request host", async () => {
    const order = createOrder([{ productId: "drift-mouse", quantity: 1 }], "ORD-REQ02");
    const origin = { rpID: "mcp-apps-nine.vercel.app", origin: "https://mcp-apps-nine.vercel.app" };
    const { request } = await buildSignedRequest(order, origin, secret);
    expect((jose.decodeJwt(request) as any).client_id).toBe("x509_san_dns:mcp-apps-nine.vercel.app");
  });
});
