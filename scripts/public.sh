#!/usr/bin/env bash
# Публичное демо с этого компьютера через Cloudflare Quick Tunnel (без регистрации).
# Работает, пока открыт терминал. Нужен cloudflared: https://github.com/cloudflare/cloudflared/releases
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=8080
export DATA_DIR="$PWD/data-public"          # отдельная база: посетители не трогают ваши локальные данные
mkdir -p "$DATA_DIR"
[ -f "$DATA_DIR/.master.key" ] || openssl rand -base64 32 > "$DATA_DIR/.master.key"
chmod 600 "$DATA_DIR/.master.key"

LOG=$(mktemp)
cloudflared tunnel --no-autoupdate --url "http://localhost:$PORT" > "$LOG" 2>&1 &
TUNNEL=$!
trap 'kill $TUNNEL 2>/dev/null' EXIT
for _ in $(seq 60); do URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true); [ -n "$URL" ] && break; sleep 1; done
[ -n "${URL:-}" ] || { cat "$LOG"; echo "Не удалось получить адрес туннеля"; exit 1; }

export NODE_ENV=production PORT PUBLIC_URL="$URL" TRUST_PROXY=loopback KYC_AUTO_APPROVE=1
export SAFEDEAL_MASTER_KEY="$(cat "$DATA_DIR/.master.key")"
[ -d client/dist ] || npm run build
npm run seed
echo; echo "Публичный адрес: $URL"; echo
npm start
