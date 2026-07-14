#!/usr/bin/env bash
# Patch production URLs into the server .env after copying secrets from the monolith.
set -euo pipefail

ENV_FILE="${1:-/var/www/slt-studio-v2/.env}"
DOMAIN="${PUBLIC_DOMAIN:-https://www.studiosweetlittletrauma.com}"
DOMAIN_NO_WWW="${DOMAIN/www./}"

upsert() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

touch "$ENV_FILE"
upsert NODE_ENV production
upsert PORT 3000
upsert SLT_STATIC_DIR ./dist
upsert PUBLIC_APP_URL "$DOMAIN"
upsert PUBLIC_WEBHOOK_BASE_URL "$DOMAIN"
upsert WEBHOOK_BASE_URL "$DOMAIN"
upsert CORS_ORIGINS "${DOMAIN},${DOMAIN_NO_WWW}"
upsert STRIPE_SUCCESS_URL "${DOMAIN}/?stripe=success"
upsert STRIPE_CANCEL_URL "${DOMAIN}/?stripe=cancel"
upsert STRIPE_PORTAL_RETURN_URL "${DOMAIN}/?stripe=portal"
upsert SLT_SITE_GATE_KEY Dientito2032
upsert VITE_SITE_GATE_KEY Dientito2032

echo "Patched $ENV_FILE for $DOMAIN"
