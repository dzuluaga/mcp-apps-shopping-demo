"""Build real AP2 SD-JWT PaymentMandates from our order + channel evidence.

Maps the TS `Order` (dollars, camelCase) onto the official `PaymentMandate`
model and signs it with the issuer key via `MandateClient.create`. The device
proof (WebAuthn assertion summary, or mdoc/OpenID4VP `transaction_data_hash` +
disclosed claims) rides inside the signed mandate's `risk_data` claim — see the
"evidence embedding" finding in the migration plan.

A single PaymentMandate is issued (no delegation chain yet); the
intent→cart→payment chain via `present()` is the deferred follow-up
(plan Task 2 Step 3).
"""

import time
import uuid
from typing import Any

import _vendor  # noqa: F401  -- prepends vendor/ so `import ap2...` resolves

from ap2.sdk.generated.payment_mandate import PaymentMandate
from ap2.sdk.generated.types.amount import Amount
from ap2.sdk.generated.types.merchant import Merchant
from ap2.sdk.generated.types.payment_instrument import PaymentInstrument
from ap2.sdk.mandate import MandateClient
from ap2.sdk.utils import compute_sha256_b64url

from keys import issuer_key
from models import BuildRequest, BuildResponse, OrderIn

# Matches the 5-minute validity the TS gates already assume.
_MANDATE_TTL_SECONDS = 300

# Default payee identity when the caller doesn't supply one (the TS side derives
# this from the request origin's rpID).
_DEFAULT_PAYEE_ID = "did:web:product-picker.local"

_client = MandateClient()


def to_minor_units(dollars: float) -> int:
    """Dollars -> integer ISO-4217 minor units. Round to avoid float drift
    (279.99 -> 27999, not 27998)."""
    return int(round(dollars * 100))


def _transaction_id(order: OrderIn) -> str:
    """base64url SHA-256 over the checkout identity, binding the mandate to
    this specific order (the AP2 `transaction_id` field)."""
    return compute_sha256_b64url(order.id)


def _payment_instrument(channel: str, authorization: dict[str, Any]) -> PaymentInstrument:
    """Channel-specific instrument. Nothing is charged — these are demo
    descriptors derived from the authorization evidence."""
    if channel == "dc":
        return PaymentInstrument(
            id=str(
                authorization.get("instrumentId")
                or authorization.get("credentialId")
                or "dc-instrument"
            ),
            type="card",
            description=str(
                authorization.get("maskedAccount")
                or "Wallet-bound payment credential (demo)"
            ),
        )
    # passkey
    return PaymentInstrument(
        id=str(authorization.get("credentialId") or "passkey-instrument"),
        type="card",
        description="Passkey-authorized card (demo)",
    )


def build_payment_mandate(req: BuildRequest) -> PaymentMandate:
    """Pure mapping: BuildRequest -> PaymentMandate model (no signing)."""
    order = req.order
    payee_id = req.payeeId or _DEFAULT_PAYEE_ID
    now = int(time.time())
    return PaymentMandate(
        transaction_id=_transaction_id(order),
        # name is required by the SDK Merchant model; for the demo we reuse the
        # id (the TS side has no separate display name to pass through).
        payee=Merchant(id=payee_id, name=payee_id),
        payment_amount=Amount(
            amount=to_minor_units(order.total), currency=order.currency
        ),
        payment_instrument=_payment_instrument(req.channel, req.authorization),
        # Device evidence carried INSIDE the signed mandate, tagged by channel.
        risk_data={"channel": req.channel, **req.authorization},
        iat=now,
        exp=now + _MANDATE_TTL_SECONDS,
    )


def build_mandate(req: BuildRequest) -> BuildResponse:
    """Build + sign, returning the compact SD-JWT and our own mandate handle."""
    payload = build_payment_mandate(req)
    token = _client.create([payload], issuer_key())
    return BuildResponse(mandate=token, mandateId=f"mandate_pm_{uuid.uuid4().hex}")
