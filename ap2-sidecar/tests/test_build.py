"""Task 2: the build endpoint produces real, verifiable AP2 mandates.

Each channel POSTs an order + evidence and gets back a compact SD-JWT, which we
then verify cryptographically with the issuer public key and assert the mapped
fields (minor-units amount, payee, embedded evidence) survive the round-trip.
"""

import _vendor  # noqa: F401

from ap2.sdk.generated.payment_mandate import PaymentMandate
from ap2.sdk.mandate import MandateClient
from fastapi.testclient import TestClient

from app import app
from keys import issuer_public_key
from mandate_build import to_minor_units

client = TestClient(app)


def _order() -> dict:
    return {
        "id": "order_test_1",
        "lines": [
            {
                "id": "lumen-monitor",
                "name": 'Lumen 27" 4K Monitor',
                "unitPrice": 449.0,
                "currency": "USD",
                "quantity": 1,
                "lineTotal": 449.0,
            },
            {
                "id": "drift-mouse",
                "name": "Drift Ergonomic Mouse",
                "unitPrice": 69.0,
                "currency": "USD",
                "quantity": 2,
                "lineTotal": 138.0,
            },
        ],
        "itemCount": 3,
        "total": 587.0,
        "currency": "USD",
        "createdAt": "2026-06-05T00:00:00Z",
    }


def _build(channel: str, authorization: dict) -> str:
    resp = client.post(
        "/ap2/payment-mandate",
        json={
            "order": _order(),
            "channel": channel,
            "authorization": authorization,
            "payeeId": "did:web:product-picker.local",
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["mandate"]
    assert body["mandateId"].startswith("mandate_pm_")
    return body["mandate"]


def _verify(token: str) -> PaymentMandate:
    mandate = MandateClient().verify(
        token=token,
        key_or_provider=issuer_public_key(),
        payload_type=PaymentMandate,
    )
    return mandate.mandate_payload


def test_to_minor_units_rounds():
    assert to_minor_units(279.99) == 27999  # not 27998
    assert to_minor_units(587.0) == 58700
    assert to_minor_units(0.1 + 0.2) == 30  # float-drift guard


def test_passkey_channel_builds_verifiable_mandate():
    token = _build(
        "passkey",
        {"credentialId": "cred-abc", "userVerified": True, "rpId": "product-picker.local"},
    )
    pm = _verify(token)
    assert pm.payment_amount.amount == 58700
    assert pm.payment_amount.currency == "USD"
    assert pm.payee.id == "did:web:product-picker.local"
    assert pm.risk_data["channel"] == "passkey"
    assert pm.risk_data["credentialId"] == "cred-abc"
    assert pm.risk_data["userVerified"] is True
    assert pm.payment_instrument.id == "cred-abc"
    # bound to this checkout, and given a validity window
    assert pm.transaction_id
    assert pm.exp > pm.iat


def test_dc_channel_builds_verifiable_mandate():
    token = _build(
        "dc",
        {"instrumentId": "instr-9", "maskedAccount": "•••• 4242", "transactionDataHash": "abc123"},
    )
    pm = _verify(token)
    assert pm.payment_amount.amount == 58700
    assert pm.risk_data["channel"] == "dc"
    assert pm.risk_data["transactionDataHash"] == "abc123"
    assert pm.payment_instrument.id == "instr-9"
    assert "4242" in pm.payment_instrument.description


def test_invalid_channel_rejected():
    resp = client.post(
        "/ap2/payment-mandate",
        json={"order": _order(), "channel": "bogus", "authorization": {}},
    )
    assert resp.status_code == 422  # pydantic Literal["passkey","dc"] rejects
