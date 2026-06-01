// Single registration ceremony as the authorization gesture. The challenge is
// recovered from the signed token (stateless), not server memory.
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { issueChallenge, verifyChallenge } from "../challengeToken.js";
import type { Origin } from "../origin.js";
import type { VerifiedAuthenticator } from "../mandate.js";

const RP_NAME = "Product Picker";

// Build registration options + a signed challenge token. userID is ephemeral —
// we never persist the credential, so a fresh random user each time is fine.
export async function buildRegistrationOptions(origin: Origin, secret: string) {
  const { challenge, token } = issueChallenge(secret);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: origin.rpID,
    userName: "product-picker-user",
    challenge: Buffer.from(challenge, "base64url"),
    attestationType: "none",
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
  });
  return { options, challengeToken: token };
}

export async function verifyPasskeyAssertion(args: {
  response: RegistrationResponseJSON;
  challengeToken: string;
  origin: Origin;
  secret: string;
}): Promise<VerifiedAuthenticator> {
  const expectedChallenge = verifyChallenge(args.challengeToken, args.secret);
  const verification = await verifyRegistrationResponse({
    response: args.response,
    expectedChallenge,
    expectedOrigin: args.origin.origin,
    expectedRPID: args.origin.rpID,
    requireUserVerification: true,
  });
  if (!verification.verified || !verification.registrationInfo) {
    throw new Error("registration not verified");
  }
  const info = verification.registrationInfo;
  return {
    credentialID: info.credential.id,
    userVerified: true,
    credentialDeviceType: info.credentialDeviceType,
    credentialBackedUp: info.credentialBackedUp,
  };
}
