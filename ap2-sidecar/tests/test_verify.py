"""Task 3: each gate passes on a good mandate and fails in isolation.

We sign mandates directly with the issuer key (sometimes after tampering a
single field) so each gate's failure path is exercised independently of the
others.
"""

import time

import _vendor  # noqa: F401

from ap2.sdk.mandate import MandateClient

from keys import issuer_key
from mandate_build import build_payment_mandate
from mandate_verify import verify_mandate
from models import BuildRequest, VerifyRequest

PAYEE = "did:web:product-picker.local"


def _order(total: float = 587.0) -> dict:
    return {
        "id": "order_v_1",
        "lines": [
            {"id": "x", "name": "X", "unitPrice": total, "currency": "USD", "quantity": 1, "lineTotal": total}
        ],
        "itemCount": 1,
        "total": total,
        "currency": "USD",
        "createdAt": "2026-06-05T00:00:00Z",
    }


def _passkey_req(**auth) -> BuildRequest:
    a = {"credentialId": "cred-abc", "userVerified": True, "rpId": "rp"}
    a.update(auth)
    return BuildRequest(order=_order(), channel="passkey", authorization=a, payeeId=PAYEE)


def _dc_req(**auth) -> BuildRequest:
    a = {
        "instrumentId": "instr-9",
        "authBlocksPresent": True,
        "transactionDataHash": "h",
        "amountBound": True,
        "bindingDetail": "hash ✓ · amount ✓",
        "credentialExpiry": int(time.time()) + 3600,
    }
    a.update(auth)
    return BuildRequest(order=_order(), channel="dc", authorization=a, payeeId=PAYEE)


def _sign(pm) -> str:
    return MandateClient().create([pm], issuer_key())


def _verify(token: str, expected_amount: float = 587.0, payee: str | None = PAYEE):
    return verify_mandate(
        VerifyRequest(
            mandate=token,
            expectedAmount=expected_amount,
            expectedCurrency="USD",
            expectedPayeeId=payee,
        )
    )


def _gates(resp) -> dict[str, bool]:
    return {g.gate: g.passed for g in resp.gates}


def test_passkey_happy_all_gates_pass():
    resp = _verify(_sign(build_payment_mandate(_passkey_req())))
    assert resp.valid is True
    g = _gates(resp)
    assert g == {
        "signature": True,
        "amount_integrity": True,
        "mandate_fresh": True,
        "payee_binding": True,
        "authorization_present": True,
        "user_verification": True,
        "subject_binding": True,
    }


def test_dc_happy_all_gates_pass():
    resp = _verify(_sign(build_payment_mandate(_dc_req())))
    assert resp.valid is True
    g = _gates(resp)
    assert g["credential_not_expired"] is True
    assert g["authorization_present"] is True
    assert g["subject_binding"] is True
    assert all(g.values())


def test_bad_signature_short_circuits():
    token = _sign(build_payment_mandate(_passkey_req()))
    jwt, sep, rest = token.partition("~")
    h, p, s = jwt.split(".")
    s_bad = ("B" if s[0] != "B" else "C") + s[1:]
    tampered = f"{h}.{p}.{s_bad}{sep}{rest}"
    resp = _verify(tampered)
    assert resp.valid is False
    assert resp.payload is None
    assert _gates(resp) == {"signature": False}  # short-circuit: only this gate


def test_tampered_amount_fails_amount_gate_only():
    resp = _verify(_sign(build_payment_mandate(_passkey_req())), expected_amount=999.0)
    g = _gates(resp)
    assert resp.valid is False
    assert g["signature"] is True
    assert g["amount_integrity"] is False
    assert g["user_verification"] is True  # other gates unaffected


def test_wrong_subject_fails_subject_gate():
    pm = build_payment_mandate(_passkey_req())
    pm.payment_instrument.id = "some-other-instrument"  # break subject binding
    resp = _verify(_sign(pm))
    g = _gates(resp)
    assert resp.valid is False
    assert g["subject_binding"] is False
    assert g["authorization_present"] is True  # isolated failure


def test_dc_expired_credential_fails():
    pm = build_payment_mandate(_dc_req(credentialExpiry=int(time.time()) - 10))
    resp = _verify(_sign(pm))
    g = _gates(resp)
    assert resp.valid is False
    assert g["credential_not_expired"] is False
    assert g["authorization_present"] is True


def test_dc_amount_not_signature_bound_fails():
    # The wallet did NOT sign the amount (TS device layer attested amountBound=false).
    pm = build_payment_mandate(_dc_req(amountBound=False, bindingDetail="hash ✗"))
    resp = _verify(_sign(pm))
    g = _gates(resp)
    assert resp.valid is False
    assert g["amount_signature_bound"] is False
    assert g["subject_binding"] is True  # isolated failure


def test_unknown_channel_fails_authorization():
    pm = build_payment_mandate(_passkey_req())
    pm.risk_data = {"channel": "bogus"}  # unrecognized channel
    resp = _verify(_sign(pm))
    g = _gates(resp)
    assert resp.valid is False
    assert g["authorization_present"] is False


def test_wrong_payee_fails_payee_gate():
    resp = _verify(_sign(build_payment_mandate(_passkey_req())), payee="did:web:attacker.example")
    g = _gates(resp)
    assert resp.valid is False
    assert g["payee_binding"] is False
