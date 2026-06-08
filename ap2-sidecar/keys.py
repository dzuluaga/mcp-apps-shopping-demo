"""Issuer signing key for AP2 mandates.

Loads an ES256 (P-256) JWK from ``AP2_ISSUER_JWK``; in dev, falls back to a
per-process generated key. This mirrors ``gateSecret()`` in
``payment-gate/challengeToken.ts``: real secret from env, ephemeral random
fallback for local use. Mandates are short-lived, so a per-process key is fine
locally — but on a multi-instance/serverless deploy the env var MUST be set, or
a mandate signed by one instance won't verify on another.
"""

import json
import logging
import os

from cryptography.hazmat.primitives.asymmetric import ec
from jwcrypto.jwk import JWK

logger = logging.getLogger("ap2_sidecar.keys")

_ISSUER_KID = "ap2-issuer-1"
_cached: JWK | None = None


def _generate() -> JWK:
    """Generate an ephemeral P-256 issuer key (matches the SDK's conftest pattern)."""
    key = ec.generate_private_key(ec.SECP256R1())
    jwk = JWK.from_pyca(key)
    data = json.loads(jwk.export())
    data["kid"] = _ISSUER_KID
    return JWK.from_json(json.dumps(data))


def issuer_key() -> JWK:
    """The private issuer JWK used to sign mandates. Cached per process."""
    global _cached
    if _cached is None:
        raw = os.environ.get("AP2_ISSUER_JWK")
        if raw:
            _cached = JWK.from_json(raw)
        else:
            logger.warning(
                "AP2_ISSUER_JWK not set; generating an ephemeral issuer key. "
                "Mandates will not verify across restarts or instances. "
                "Set AP2_ISSUER_JWK in any real deployment."
            )
            _cached = _generate()
    return _cached


def issuer_public_key() -> JWK:
    """The public half of the issuer key, for verification."""
    return JWK.from_json(issuer_key().export_public())
