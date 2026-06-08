"""Put the vendored AP2 SDK on the import path.

The SDK (`vendor/ap2/`) ships no installable package (Task 0 finding), so we
vendor it and prepend `vendor/` to ``sys.path``. Import this module *before*
any ``import ap2...`` — e.g. ``import _vendor  # noqa: F401``.
"""

import pathlib
import sys

_VENDOR_DIR = pathlib.Path(__file__).resolve().parent / "vendor"

if _VENDOR_DIR.is_dir() and str(_VENDOR_DIR) not in sys.path:
    sys.path.insert(0, str(_VENDOR_DIR))
