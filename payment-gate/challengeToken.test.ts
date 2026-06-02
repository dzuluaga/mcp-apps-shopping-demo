import { describe, it, expect } from "vitest";
import { issueChallenge, verifyChallenge } from "./challengeToken.js";

const SECRET = "test-secret";

describe("challengeToken", () => {
  it("round-trips: verify recovers the issued challenge", () => {
    const { challenge, token } = issueChallenge(SECRET);
    expect(verifyChallenge(token, SECRET)).toBe(challenge);
  });

  it("rejects a token signed with a different secret", () => {
    const { token } = issueChallenge(SECRET);
    expect(() => verifyChallenge(token, "other-secret")).toThrow();
  });

  it("rejects a tampered challenge", () => {
    const { token } = issueChallenge(SECRET);
    const [chal, exp, sig] = token.split(".");
    const tampered = `${chal}X.${exp}.${sig}`;
    expect(() => verifyChallenge(tampered, SECRET)).toThrow();
  });

  it("rejects an expired token", () => {
    const { token } = issueChallenge(SECRET, -1); // already expired
    expect(() => verifyChallenge(token, SECRET)).toThrow(/expired/i);
  });
});
