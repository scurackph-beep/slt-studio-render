#!/usr/bin/env bash
set -euo pipefail
cat >/dev/null || true
python3 - <<'PY'
import json
print(json.dumps({
  "additional_context": (
    "App name locked: DJ The Unicorn. "
    "Credit only: By Sweet Little Trauma. "
    "Logo/aesthetics deferred to the end. "
    "If on Cloud Linux, stop and switch to Mac Local."
  )
}))
PY
