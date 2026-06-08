# AP2 Sidecar

A small Python service that wraps the **official AP2 SDK**
(https://github.com/google-agentic-commerce/AP2, `code/sdk/python/ap2`) so the
TypeScript payment-gate routes can produce and verify real AP2 **SD-JWT
PaymentMandates** over HTTP.

It exists because the AP2 SDK is Python-only and ships no installable package,
so we **vendor** it (`vendor/ap2/`, pinned commit in `vendor/ap2/VENDOR.txt`) and
expose it behind a thin HTTP API. See the migration plan:
`docs/superpowers/plans/2026-06-05-ap2-python-sdk-sidecar.md`.

## Layout

```
app.py        FastAPI entry point (uvicorn app:app; also the Vercel function)
keys.py       issuer ES256/P-256 JWK — AP2_ISSUER_JWK env, dev fallback generates one
models.py     the TS<->Python wire contract (mirrors Order/PricedCartLine, GateResult)
_vendor.py    prepends vendor/ to sys.path so `import ap2...` resolves
vendor/ap2/   vendored AP2 SDK (do not edit; re-vendor from the pinned commit)
tests/        pytest smoke + vendoring checks
```

## Endpoints

- `GET /healthz` — liveness; also confirms the vendored SDK imports.
- `POST /ap2/payment-mandate` — build a mandate (Task 2).
- `POST /ap2/payment-mandate/verify` — verify + gate a mandate (Task 3).

## Develop

Target Python **3.12** (matches the Vercel runtime; SDK needs ≥3.11).

```bash
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
.venv/bin/pytest -q          # tests
.venv/bin/uvicorn app:app --port 8787   # run locally
```

## Env

- `AP2_ISSUER_JWK` — JSON JWK (private, ES256/P-256) that signs mandates.
  Unset → an ephemeral per-process key is generated (dev only; won't verify
  across instances).
