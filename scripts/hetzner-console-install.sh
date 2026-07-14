#!/usr/bin/env bash
# Paste this ENTIRE script in Hetzner Cloud → your server → Console (browser).
# It installs the studio on www.studiosweetlittletrauma.com (replaces garage landing).
set -euo pipefail

APP_DIR="/var/www/slt-studio-v2"
REPO="https://github.com/scurackph-beep/slt-studio-render.git"
DOMAIN="https://www.studiosweetlittletrauma.com"

apt-get update -qq
apt-get install -y -qq git curl nginx

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | sed 's/v//' | cut -d. -f1)" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi

mkdir -p /var/www
if [[ -d "$APP_DIR/.git" ]]; then
  cd "$APP_DIR"
  git fetch origin main
  git reset --hard origin/main
else
  rm -rf "$APP_DIR"
  git clone "$REPO" "$APP_DIR"
  cd "$APP_DIR"
fi

npm ci --omit=dev
npm run build

if [[ ! -f "$APP_DIR/.env" ]]; then
  echo "WARN: $APP_DIR/.env missing — copy your PROYECTO_COMPLETO .env to the server first."
  echo "Example from your Mac: scp \"/Users/sweetlittletrauma/Desktop/Sweet Little Trauma Produccion/PROYECTO_COMPLETO/.env\" root@87.99.147.67:$APP_DIR/.env"
  exit 1
fi

chmod +x deploy/hetzner/patch-production-env.sh
PUBLIC_DOMAIN="$DOMAIN" ./deploy/hetzner/patch-production-env.sh "$APP_DIR/.env"

cp deploy/hetzner/nginx-studiosweetlittletrauma.conf /etc/nginx/sites-available/studiosweetlittletrauma.com
ln -sf /etc/nginx/sites-available/studiosweetlittletrauma.com /etc/nginx/sites-enabled/studiosweetlittletrauma.com
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

cp deploy/hetzner/slt-studio.service /etc/systemd/system/slt-studio.service
systemctl daemon-reload
systemctl enable slt-studio
systemctl restart slt-studio

sleep 2
curl -sS -H "x-slt-site-gate: Dientito2032" http://127.0.0.1:3000/health | head -c 200
echo ""
echo "DONE. Open $DOMAIN and enter gate: Dientito2032"
