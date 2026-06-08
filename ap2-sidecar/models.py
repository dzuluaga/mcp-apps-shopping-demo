"""The TS <-> Python wire contract for the AP2 sidecar.

Field names mirror the TypeScript types (camelCase) so the TS client
(`payment-gate/ap2Client.ts`, Task 4) can send/receive without a translation
layer. `OrderIn` mirrors `Order` / `PricedCartLine` in `catalog.ts`.

Amounts here are DOLLARS (floats), matching the TS cart. Conversion to AP2's
integer minor units happens inside the sidecar (Task 2), not on the wire.
"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class LineItemIn(BaseModel):
    """Mirrors `PricedCartLine` in catalog.ts."""

    id: str
    name: str
    unitPrice: float
    currency: str
    quantity: int
    lineTotal: float


class OrderIn(BaseModel):
    """Mirrors `Order` in catalog.ts."""

    id: str
    lines: list[LineItemIn]
    itemCount: int
    total: float
    currency: str
    createdAt: str | None = None


class BuildRequest(BaseModel):
    order: OrderIn
    channel: Literal["passkey", "dc"]
    # Channel-specific evidence (WebAuthn assertion summary, or mdoc/OpenID4VP
    # transaction_data_hash + disclosed claims). Kept loose at the boundary;
    # Task 2 narrows it per channel.
    authorization: dict[str, Any] = Field(default_factory=dict)
    payeeId: str | None = None


class BuildResponse(BaseModel):
    mandate: str  # compact SD-JWT serialization
    mandateId: str


class GateResult(BaseModel):
    """One validation gate's outcome. Wire shape is {gate, pass, detail} to
    match the TS `GateResult` the widget receipt renders. `pass` is a Python
    keyword, so the attribute is `passed` with a wire alias."""

    model_config = ConfigDict(populate_by_name=True)

    gate: str
    passed: bool = Field(validation_alias="pass", serialization_alias="pass")
    detail: str


class VerifyRequest(BaseModel):
    mandate: str
    expectedAmount: float  # dollars
    expectedCurrency: str
    expectedPayeeId: str | None = None


class VerifyResponse(BaseModel):
    valid: bool
    gates: list[GateResult]
    payload: dict[str, Any] | None = None
