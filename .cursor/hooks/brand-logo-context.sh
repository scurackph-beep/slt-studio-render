#!/usr/bin/env bash
# Injects brand/logo constraints at session start for the music player work.
set -euo pipefail
cat >/dev/null || true
python3 - <<'PY'
import json
print(json.dumps({
  "additional_context": (
    "BRAND / LOGO RULES for the music player: "
    "1) Never reuse or crop the old neon rainbow / Studio logo. "
    "2) Redesign from scratch. "
    "3) App name must not include Sweet, Little, or Trauma. "
    "4) Credit only as 'By Sweet Little Trauma'. "
    "5) Logo aesthetic board lives at "
    "/home/ubuntu/.cursor/projects/workspace/canvases/logo-estetico.canvas.tsx "
    "(or the workspace canvases/logo-estetico.canvas.tsx). "
    "Update that canvas when iterating on logo/name."
  )
}))
PY
