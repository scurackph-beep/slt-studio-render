#!/usr/bin/env bash
# Blocks productive agent work when running on Cursor Cloud Linux.
set -euo pipefail
input=$(cat || true)

is_linux_cloud=0
if [[ "$(uname -s 2>/dev/null || echo unknown)" == "Linux" ]]; then
  if [[ -d /workspace && ! -d /Users/sweetlittletrauma ]]; then
    is_linux_cloud=1
  fi
fi
if [[ "${CURSOR_CLOUD:-}" == "1" || "${CURSOR_AGENT_CLOUD:-}" == "1" ]]; then
  is_linux_cloud=1
fi

if [[ "$is_linux_cloud" -eq 1 ]]; then
  python3 - <<'PY'
import json
msg = (
  "BLOCKED: this session is Cursor Cloud on Linux remote. "
  "User requires Apple Mac local only (Xcode + iPhone). "
  "Do not implement features here. Instruct user to: "
  "1) stop this Cloud Agent on cursor.com/agents; "
  "2) open Cursor Desktop on Mac; "
  "3) File→Open Folder on the local player/studio project; "
  "4) select Local/This Mac (not Cloud) in the agent dropdown; "
  "5) continue the DJ The Unicorn / player work there."
)
print(json.dumps({
  "additional_context": msg,
  "permission": "deny",
  "user_message": "Cloud Linux bloqueado. Abrí Cursor en tu Mac (Local), no Cloud.",
  "agent_message": msg,
}))
PY
  exit 0
fi

echo '{ "permission": "allow" }'
exit 0
