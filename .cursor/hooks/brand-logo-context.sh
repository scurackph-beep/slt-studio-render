#!/usr/bin/env bash
# Injects brand/logo constraints at session start for the music player work.
set -euo pipefail
cat >/dev/null || true
python3 - <<'PY'
import json
print(json.dumps({
  "additional_context": (
    "BRAND / LOGO RULES for the music player: "
    "1) App name is LOCKED: DJ The Unicorn (from the unicorn avatar). "
    "2) Credit only as 'By Sweet Little Trauma' — never put Sweet/Little/Trauma in the app title. "
    "3) Never reuse or crop the old neon rainbow / Studio logo. "
    "4) Prefer the unicorn-with-headphones mascot mark. "
    "5) Logo board: canvases/logo-estetico.canvas.tsx ; PNG: public/assets/dj-the-unicorn-logo.png."
  )
}))
PY
