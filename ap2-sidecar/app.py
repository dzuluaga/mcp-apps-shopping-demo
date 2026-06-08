"""AP2 sidecar — FastAPI service wrapping the official AP2 SDK.

Exposes mandate build/verify so the TypeScript payment-gate routes can produce
and validate real AP2 SD-JWT PaymentMandates over HTTP. This file is the entry
point for both local uvicorn (`uvicorn app:app`) and the Vercel Python function
(Task 5).

Endpoints land here across tasks:
  GET  /healthz                      (this task)
  POST /ap2/payment-mandate          (Task 2)
  POST /ap2/payment-mandate/verify   (Task 3)
"""

import _vendor  # noqa: F401  -- prepends vendor/ so `import ap2...` resolves

from fastapi import FastAPI

from mandate_build import build_mandate
from mandate_verify import verify_mandate
from models import BuildRequest, BuildResponse, VerifyRequest, VerifyResponse

app = FastAPI(title="AP2 Sidecar", version="0.1.0")


@app.get("/healthz")
def healthz() -> dict[str, object]:
    """Liveness probe. Confirms the vendored SDK imports in-process."""
    from ap2.sdk.mandate import MandateClient  # local import: proves vendoring

    return {"ok": True, "service": "ap2-sidecar", "sdk": MandateClient.__name__}


@app.post("/ap2/payment-mandate", response_model=BuildResponse)
def post_payment_mandate(req: BuildRequest) -> BuildResponse:
    """Build + sign an AP2 SD-JWT PaymentMandate from the order + evidence."""
    return build_mandate(req)


@app.post("/ap2/payment-mandate/verify", response_model=VerifyResponse)
def post_verify_payment_mandate(req: VerifyRequest) -> VerifyResponse:
    """Verify the SD-JWT envelope and run the validation gates."""
    return verify_mandate(req)
