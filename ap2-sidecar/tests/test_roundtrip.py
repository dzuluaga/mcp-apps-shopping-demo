"""Task 3: end-to-end build -> verify through the HTTP endpoints.

Exercises the full wire path a TS caller will use (Task 4): POST the order +
evidence to build, then POST the returned mandate to verify.
"""

import _vendor  # noqa: F401

from fastapi.testclient import TestClient

from app import app

client = TestClient(app)

PAYEE = "did:web:product-picker.local"


def _order(total: float = 587.0) -> dict:
    return {
        "id": "order_rt_1",
        "lines": [
            {"id": "x", "name": "X", "unitPrice": total, "currency": "USD", "quantity": 1, "lineTotal": total}
        ],
        "itemCount": 1,
        "total": total,
        "currency": "USD",
        "createdAt": "2026-06-05T00:00:00Z",
    }


def _build(channel: str, authorization: dict) -> str:
    r = client.post(
        "/ap2/payment-mandate",
        json={"order": _order(), "channel": channel, "authorization": authorization, "payeeId": PAYEE},
    )
    assert r.status_code == 200, r.text
    return r.json()["mandate"]


def _verify(mandate: str, expected_amount: float = 587.0) -> dict:
    r = client.post(
        "/ap2/payment-mandate/verify",
        json={
            "mandate": mandate,
            "expectedAmount": expected_amount,
            "expectedCurrency": "USD",
            "expectedPayeeId": PAYEE,
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_roundtrip_passkey_valid():
    mandate = _build("passkey", {"credentialId": "cred-1", "userVerified": True})
    body = _verify(mandate)
    assert body["valid"] is True
    # wire shape uses `pass`, not `passed`
    assert all(g["pass"] for g in body["gates"])
    assert {"gate", "pass", "detail"} == set(body["gates"][0])
    assert body["payload"]["payment_amount"]["amount"] == 58700


def test_roundtrip_dc_valid():
    mandate = _build(
        "dc",
        {
            "instrumentId": "instr-1",
            "authBlocksPresent": True,
            "transactionDataHash": "h",
            "amountBound": True,
            "bindingDetail": "hash ✓",
            "credentialExpiry": 9999999999,
        },
    )
    body = _verify(mandate)
    assert body["valid"] is True
    assert all(g["pass"] for g in body["gates"])


def test_roundtrip_amount_mismatch_invalid():
    mandate = _build("passkey", {"credentialId": "cred-1", "userVerified": True})
    body = _verify(mandate, expected_amount=12.34)
    assert body["valid"] is False
    failed = [g["gate"] for g in body["gates"] if not g["pass"]]
    assert failed == ["amount_integrity"]


def test_roundtrip_bad_signature_invalid():
    mandate = _build("passkey", {"credentialId": "cred-1", "userVerified": True})
    jwt, sep, rest = mandate.partition("~")
    h, p, s = jwt.split(".")
    tampered = f"{h}.{p}.{('B' if s[0] != 'B' else 'C') + s[1:]}{sep}{rest}"
    body = _verify(tampered)
    assert body["valid"] is False
    assert body["gates"] == [g for g in body["gates"] if g["gate"] == "signature"]
    assert body["gates"][0]["pass"] is False
    assert body["payload"] is None
