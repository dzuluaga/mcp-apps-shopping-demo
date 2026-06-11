import { describe, it, expect } from "vitest";
import { buildCredentialDcql } from "./dcql.js";

describe("buildCredentialDcql", () => {
  it("age query requests mDL age_over_21 / age_over_18", () => {
    const dcql = buildCredentialDcql("age");
    const ids = dcql.credentials.map((c) => c.id);
    expect(ids).toContain("mdl");
    const mdl = dcql.credentials.find((c) => c.id === "mdl")!;
    expect(mdl.meta.doctype_value).toBe("org.iso.18013.5.1.mDL");
    const paths = mdl.claims.map((c) => c.path.join("/"));
    expect(paths).toContain("org.iso.18013.5.1/age_over_21");
    expect(paths).toContain("org.iso.18013.5.1/age_over_18");
  });

  it("loyalty query requests the loyalty doctype", () => {
    const dcql = buildCredentialDcql("loyalty");
    const opt = dcql.credentials[0];
    expect(opt.meta.doctype_value).toBe("org.multipaz.loyalty.1");
    const paths = opt.claims.map((c) => c.path.join("/"));
    expect(paths).toContain("org.multipaz.loyalty.1/membership_number");
  });
});
