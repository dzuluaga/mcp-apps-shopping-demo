// DCQL builders for the non-payment credential gate, ported from a2ui_concierge
// (mcp/data.py + mcp/dcql.py). One query per kind, embedded in the signed
// OpenID4VP request. verify.ts maps disclosed claims back to a boolean.
export type CredentialKind = "age" | "loyalty";

export interface CredClaim {
  path: string[];
  intent_to_retain?: boolean;
}

export interface CredOption {
  id: string;
  format: "mso_mdoc";
  meta: Record<string, string>;
  claims: CredClaim[];
}

export interface CredentialDcql {
  credentials: CredOption[];
}

const AGE_OPTIONS: CredOption[] = [
  {
    id: "mdl",
    format: "mso_mdoc",
    meta: { doctype_value: "org.iso.18013.5.1.mDL" },
    claims: [
      { path: ["org.iso.18013.5.1", "age_over_21"], intent_to_retain: false },
      { path: ["org.iso.18013.5.1", "age_over_18"], intent_to_retain: false },
    ],
  },
  {
    id: "eupid",
    format: "mso_mdoc",
    meta: { doctype_value: "eu.europa.ec.eudi.pid.1" },
    claims: [{ path: ["eu.europa.ec.eudi.pid.1", "age_over_18"], intent_to_retain: false }],
  },
];

const LOYALTY_OPTIONS: CredOption[] = [
  {
    id: "loyalty",
    format: "mso_mdoc",
    meta: { doctype_value: "org.multipaz.loyalty.1" },
    claims: [
      { path: ["org.multipaz.loyalty.1", "membership_number"], intent_to_retain: false },
      { path: ["org.multipaz.loyalty.1", "tier"], intent_to_retain: false },
    ],
  },
];

export function buildCredentialDcql(kind: CredentialKind): CredentialDcql {
  return { credentials: kind === "age" ? AGE_OPTIONS : LOYALTY_OPTIONS };
}
