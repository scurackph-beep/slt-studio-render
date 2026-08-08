#!/bin/bash
cd "$(dirname "$0")" || exit 1
PORT=8765
IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo localhost)"

echo ""
echo "========================================"
echo "  BullShit Mp3 Easy Reproductor"
echo "  By Sweet Little Trauma"
echo "========================================"
echo "  Mac:    http://localhost:$PORT"
echo "  iPhone: http://$IP:$PORT"
echo "========================================"
echo ""

# liberar puerto si quedó algo colgado
lsof -i :$PORT -t 2>/dev/null | xargs kill 2>/dev/null
sleep 0.2

if command -v open >/dev/null 2>&1; then
  (sleep 1; open "http://localhost:$PORT") &
fi

python3 server.py
