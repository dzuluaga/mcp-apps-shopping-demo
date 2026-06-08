"""Vercel Python serverless function exposing the AP2 sidecar.

vercel.json rewrites `/ap2/*` here and `includeFiles` bundles `ap2-sidecar/**`
(the FastAPI app + the vendored AP2 SDK). Vercel's Python runtime serves the
exported ASGI `app` directly — no uvicorn at runtime. The sidecar's routes are
defined at `/ap2/payment-mandate[/verify]`, which is the original request path
Vercel passes through, so they match without prefix juggling.

Deps come from the project-root requirements.txt. Set AP2_ISSUER_JWK in the
Vercel project so mandates verify across invocations.
"""

import pathlib
import sys

# Put ap2-sidecar/ on the path so `import app` (and its `import _vendor`, which
# in turn adds vendor/ap2) resolve.
_SIDECAR = pathlib.Path(__file__).resolve().parents[2] / "ap2-sidecar"
if str(_SIDECAR) not in sys.path:
    sys.path.insert(0, str(_SIDECAR))

from app import app  # noqa: E402  -- ASGI app picked up by the Vercel Python runtime

__all__ = ["app"]
