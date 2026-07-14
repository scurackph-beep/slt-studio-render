#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${DEPLOY_HOST:-root@87.99.147.67}"
SSH_KEY="${DEPLOY_SSH_KEY:-$HOME/.ssh/slt-hetzner}"
SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
if [[ -f "$SSH_KEY" ]]; then
  SSH_OPTS+=(-i "$SSH_KEY")
fi
SSH_CMD="ssh ${SSH_OPTS[*]}"
REMOTE_DIR="${DEPLOY_PATH:-/var/www/slt-studio-v2}"
ENV_SOURCE="${ENV_SOURCE:-/Users/sweetlittletrauma/Desktop/Sweet Little Trauma Produccion/PROYECTO_COMPLETO/.env}"
DOMAIN="${PUBLIC_DOMAIN:-https://www.studiosweetlittletrauma.com}"

echo "==> Deploying slt-studio-v2 to ${HOST}:${REMOTE_DIR}"

cd "$ROOT_DIR"
npm run build

rsync -avz --delete -e "$SSH_CMD" \
  --exclude node_modules \
  --exclude .git \
  --exclude storage \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude '.env.local' \
  "$ROOT_DIR/" "${HOST}:${REMOTE_DIR}/"

if [[ -f "$ENV_SOURCE" ]]; then
  scp "${SSH_OPTS[@]}" "$ENV_SOURCE" "${HOST}:${REMOTE_DIR}/.env"
else
  echo "WARN: ENV_SOURCE not found at $ENV_SOURCE — keep existing remote .env"
fi

ssh "${SSH_OPTS[@]}" "$HOST" bash -s <<EOF
set -euo pipefail
cd ${REMOTE_DIR}
chmod +x deploy/hetzner/patch-production-env.sh
PUBLIC_DOMAIN=${DOMAIN} ./deploy/hetzner/patch-production-env.sh ${REMOTE_DIR}/.env
npm ci --omit=dev
npm run build
chown -R www-data:www-data ${REMOTE_DIR}
cp deploy/hetzner/nginx-studiosweetlittletrauma.conf /etc/nginx/sites-available/studiosweetlittletrauma.com
ln -sf /etc/nginx/sites-available/studiosweetlittletrauma.com /etc/nginx/sites-enabled/studiosweetlittletrauma.com
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
cp deploy/hetzner/slt-studio.service /etc/systemd/system/slt-studio.service
systemctl daemon-reload
systemctl enable slt-studio
systemctl restart slt-studio
systemctl --no-pager status slt-studio | head -15
curl -sS -H 'x-slt-site-gate: Dientito2032' http://127.0.0.1:3000/health | head -c 200
echo
EOF

echo "==> Done. Open ${DOMAIN} and enter gate key: Dientito2032"
