"""Prove the vendored AP2 SDK imports and the issuer key + contract models work.

This de-risks Tasks 2-3: if the vendored package, jwcrypto keys, and the
PaymentMandate model are all importable here, the build/verify endpoints can be
written against them.
"""

import _vendor  # noqa: F401


def test_sdk_imports():
    from ap2.sdk.generated.payment_mandate import PaymentMandate
    from ap2.sdk.mandate import MandateClient

    assert callable(MandateClient)
    assert PaymentMandate.model_fields  # pydantic model loaded


def test_issuer_key_roundtrips():
    from keys import issuer_key, issuer_public_key

    priv = issuer_key()
    pub = issuer_public_key()
    # Same key, and the public export carries no private component.
    assert priv.export_public() == pub.export_public()
    assert "d" not in pub.export(as_dict=True)


def test_gate_result_wire_alias():
    from models import GateResult

    g = GateResult(gate="amount", passed=True, detail="ok")
    dumped = g.model_dump(by_alias=True)
    assert dumped == {"gate": "amount", "pass": True, "detail": "ok"}
