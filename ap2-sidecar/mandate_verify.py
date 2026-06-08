"""Verify AP2 SD-JWT mandates and run the validation gates.

Division of labor (important):
- **The SDK** does the real cryptographic envelope check: `MandateClient.verify`
  validates the SD-JWT issuer signature / chain / selective disclosure. This
  replaces the old `MOCK-DEV-SIGNER` gate with actual crypto.
- **The sidecar** re-derives amount / payee / subject from the *signed* payload
  (so these gates never trust an unsigned input), and checks the device-evidence
  summary carried in `risk_data`.
- **The TS device layer** (Task 4) still performs the real WebAuthn-assertion /
  mdoc-signature + `transaction_data_hash` verification before calling here; the
  `userVerified` / `authBlocksPresent` / `credentialExpiry` values in `risk_data`
  are the attested results of that work. The sidecar checks them but does not
  re-run the device crypto (it doesn't hold the raw assertion / DeviceResponse).

Every gate emits `{gate, pass, detail}` (the TS `GateResult` shape).
"""

import datetime
import time
from collections.abc import Iterator
from typing import Any

import _vendor  # noqa: F401  -- prepends vendor/ so `import ap2...` resolves

from ap2.sdk.generated.payment_mandate import PaymentMandate
from ap2.sdk.mandate import MandateClient

from keys import issuer_public_key
from mandate_build import to_minor_units
from models import GateResult, VerifyRequest, VerifyResponse

_client = MandateClient()


def _gate(gate: str, passed: bool, detail: str) -> GateResult:
    return GateResult(gate=gate, passed=passed, detail=detail)


def verify_mandate(req: VerifyRequest) -> VerifyResponse:
    # Gate 1 — envelope signature (real SD-JWT crypto). If this fails nothing
    # else is trustworthy, so short-circuit with just the signature gate.
    try:
        verified = _client.verify(
            token=req.mandate,
            key_or_provider=issuer_public_key(),
            payload_type=PaymentMandate,
        )
        pm: PaymentMandate = verified.mandate_payload
    except Exception as e:  # noqa: BLE001 -- any verify failure = bad envelope
        return VerifyResponse(
            valid=False,
            gates=[_gate("signature", False, f"SD-JWT verification failed: {type(e).__name__}")],
            payload=None,
        )

    gates: list[GateResult] = [_gate("signature", True, "SD-JWT issuer signature valid")]
    risk: dict[str, Any] = pm.risk_data or {}
    channel = risk.get("channel")

    # Gate 2 — amount integrity, re-derived from the SIGNED payload.
    expected_minor = to_minor_units(req.expectedAmount)
    amount_ok = (
        pm.payment_amount.amount == expected_minor
        and pm.payment_amount.currency == req.expectedCurrency
    )
    gates.append(
        _gate(
            "amount_integrity",
            amount_ok,
            f"mandate {pm.payment_amount.amount} {pm.payment_amount.currency} "
            f"vs expected {expected_minor} {req.expectedCurrency}",
        )
    )

    # Gate 3 — mandate freshness (the mandate's own signed exp window).
    if pm.exp is not None:
        fresh = pm.exp > int(time.time())
        gates.append(_gate("mandate_fresh", fresh, f"exp={pm.exp}"))

    # Gate 4 — payee binding, when an expected payee is supplied.
    if req.expectedPayeeId is not None:
        gates.append(
            _gate(
                "payee_binding",
                pm.payee.id == req.expectedPayeeId,
                f"payee {pm.payee.id} vs expected {req.expectedPayeeId}",
            )
        )

    # Channel-specific evidence gates.
    if channel == "passkey":
        gates.extend(_passkey_gates(pm, risk))
    elif channel == "dc":
        gates.extend(_dc_gates(pm, risk))
    else:
        gates.append(
            _gate("authorization_present", False, f"unknown or missing channel: {channel!r}")
        )

    valid = all(g.passed for g in gates)
    return VerifyResponse(valid=valid, gates=gates, payload=pm.model_dump(mode="json"))


def _passkey_gates(pm: PaymentMandate, risk: dict[str, Any]) -> Iterator[GateResult]:
    cred = risk.get("credentialId")
    yield _gate(
        "authorization_present",
        bool(cred),
        "webauthn assertion present" if cred else "missing credentialId",
    )
    yield _gate(
        "user_verification",
        risk.get("userVerified") is True,
        f"userVerified={risk.get('userVerified')!r}",
    )
    # Subject binding: the instrument minted into the signed mandate must match
    # the authenticator credential the assertion was made with.
    yield _gate(
        "subject_binding",
        pm.payment_instrument.id == cred,
        f"instrument {pm.payment_instrument.id} vs credential {cred}",
    )


def _dc_gates(pm: PaymentMandate, risk: dict[str, Any]) -> Iterator[GateResult]:
    auth_present = bool(risk.get("authBlocksPresent")) or bool(risk.get("transactionDataHash"))
    yield _gate(
        "authorization_present",
        auth_present,
        "openid4vp auth blocks present" if auth_present else "missing vp/auth evidence",
    )
    # The wallet-signed amount binding is verified in the TS device layer (which
    # holds the vp_token); we gate on its attested result. `bindingDetail` carries
    # the human-readable breakdown.
    yield _gate(
        "amount_signature_bound",
        risk.get("amountBound") is True,
        str(risk.get("bindingDetail") or f"amountBound={risk.get('amountBound')!r}"),
    )
    ok, detail = _expiry_check(risk.get("credentialExpiry"))
    yield _gate("credential_not_expired", ok, detail)
    instr = risk.get("instrumentId")
    yield _gate(
        "subject_binding",
        pm.payment_instrument.id == instr,
        f"instrument {pm.payment_instrument.id} vs disclosed {instr}",
    )


def _expiry_check(expiry: Any) -> tuple[bool, str]:
    """Accept a unix epoch (int/float) or an ISO-8601 date string."""
    if not expiry:
        return False, "no credentialExpiry provided"
    try:
        if isinstance(expiry, (int, float)):
            exp_ts = float(expiry)
        else:
            exp_ts = datetime.datetime.fromisoformat(
                str(expiry).replace("Z", "+00:00")
            ).timestamp()
    except (ValueError, TypeError):
        return False, f"unparseable credentialExpiry: {expiry!r}"
    ok = exp_ts > time.time()
    return ok, f"expires {expiry} ({'future' if ok else 'past'})"
