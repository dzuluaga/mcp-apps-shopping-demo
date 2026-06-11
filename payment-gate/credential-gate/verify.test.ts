import { describe, it, expect } from "vitest";
import { evaluateCredential } from "./verify.js";
import type { DisclosedEntry } from "../dc-payment/mdoc.js";

function disclosed(label: string, value: unknown): DisclosedEntry[] {
  return [{ id: "x", format: "mso_mdoc", claims: [{ label, value }] }];
}

describe("evaluateCredential — age (fails closed, threshold = product)", () => {
  it("passes a 21+ gate when age_over_21 is true", () => {
    const r = evaluateCredential("age", disclosed("org.iso.18013.5.1 / age_over_21", true), { minimumAge: 21 });
    expect(r.verified).toBe(true);
  });
  it("passes a 21+ gate when age_in_years >= 21", () => {
    const r = evaluateCredential("age", disclosed("org.iso.18013.5.1 / age_in_years", 34), { minimumAge: 21 });
    expect(r.verified).toBe(true);
  });
  it("FAILS when a token is returned but no age claim is disclosed", () => {
    // Token-presence must not pass the gate — DCQL requesting a claim does not
    // constrain its value.
    const r = evaluateCredential("age", [], { tokenPresent: true, minimumAge: 21 });
    expect(r.verified).toBe(false);
  });
  it("FAILS when age_over_21 is explicitly false (even with a token)", () => {
    const r = evaluateCredential("age", disclosed("org.iso.18013.5.1 / age_over_21", false), { tokenPresent: true, minimumAge: 21 });
    expect(r.verified).toBe(false);
  });
  it("FAILS a 21+ gate on age_over_18 alone", () => {
    const r = evaluateCredential("age", disclosed("eu.europa.ec.eudi.pid.1 / age_over_18", true), { minimumAge: 21 });
    expect(r.verified).toBe(false);
  });
  it("FAILS a 21+ gate when age_in_years is 19", () => {
    const r = evaluateCredential("age", disclosed("org.iso.18013.5.1 / age_in_years", 19), { minimumAge: 21 });
    expect(r.verified).toBe(false);
  });
  it("passes an 18+ gate on age_over_18 (threshold tied to the product)", () => {
    const r = evaluateCredential("age", disclosed("eu.europa.ec.eudi.pid.1 / age_over_18", true), { minimumAge: 18 });
    expect(r.verified).toBe(true);
  });
  it("defaults to a 21+ threshold when none is supplied", () => {
    const over18 = evaluateCredential("age", disclosed("eu.europa.ec.eudi.pid.1 / age_over_18", true));
    expect(over18.verified).toBe(false);
    const over21 = evaluateCredential("age", disclosed("org.iso.18013.5.1 / age_over_21", true));
    expect(over21.verified).toBe(true);
  });
});

describe("evaluateCredential — loyalty (requires a membership number)", () => {
  it("passes and captures a disclosed membership number", () => {
    const r = evaluateCredential("loyalty", disclosed("org.multipaz.loyalty.1 / membership_number", "LM-9001"));
    expect(r.verified).toBe(true);
    expect(r.membershipNumber).toBe("LM-9001");
  });
  it("FAILS when a token is returned but no membership_number is disclosed", () => {
    const r = evaluateCredential("loyalty", []);
    expect(r.verified).toBe(false);
    expect(r.membershipNumber).toBeNull();
  });
  it("FAILS on an unrelated claim with no membership_number (e.g. tier only)", () => {
    const r = evaluateCredential("loyalty", disclosed("org.multipaz.loyalty.1 / tier", "gold"));
    expect(r.verified).toBe(false);
    expect(r.membershipNumber).toBeNull();
  });
  it("FAILS on a blank membership number", () => {
    const r = evaluateCredential("loyalty", disclosed("org.multipaz.loyalty.1 / membership_number", "   "));
    expect(r.verified).toBe(false);
  });
});
