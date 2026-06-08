"""Pytest bootstrap: make the sidecar's top-level modules importable from tests/.

Placing this at the sidecar root puts that root on sys.path so tests can
`import app`, `import keys`, `import models`. The modules themselves pull in the
vendored SDK via `_vendor`.
"""

import pathlib
import sys

_ROOT = pathlib.Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))
