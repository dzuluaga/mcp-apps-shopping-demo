"""Smoke test: the app boots and the health probe reports the SDK is importable."""

from fastapi.testclient import TestClient

from app import app

client = TestClient(app)


def test_healthz_ok():
    resp = client.get("/healthz")
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["service"] == "ap2-sidecar"
    # /healthz imports the vendored MandateClient in-process, so a 200 here also
    # proves the vendoring resolves under the app runtime.
    assert body["sdk"] == "MandateClient"
