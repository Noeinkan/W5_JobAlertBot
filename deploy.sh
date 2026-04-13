#!/usr/bin/env bash
# deploy.sh — sync local code to Hetzner and restart pm2 apps
# Run from Git Bash: bash deploy.sh
# Options:
#   --env   also upload .env (skipped by default to protect server secrets)
#   --bot   restart job-alert-bot too (default: dashboard only)
#   --all   restart both apps
set -euo pipefail

SERVER="root@77.42.70.26"
REMOTE="/opt/job-alert-bot"
LOCAL="$(cd "$(dirname "$0")" && pwd)"

UPLOAD_ENV=false
RESTART_BOT=false

for arg in "$@"; do
  case $arg in
    --env) UPLOAD_ENV=true ;;
    --bot) RESTART_BOT=true ;;
    --all) RESTART_BOT=true ;;
  esac
done

# ── 1. Sync code ──────────────────────────────────────────────────────────────
echo "→ Syncing code to $SERVER:$REMOTE …"
rsync -az --delete \
  --exclude='.git/' \
  --exclude='node_modules/' \
  --exclude='logs/' \
  --exclude='*.db' \
  --exclude='*.db-shm' \
  --exclude='*.db-wal' \
  --exclude='.env' \
  "$LOCAL/" "$SERVER:$REMOTE/"

# ── 2. Optionally upload .env ─────────────────────────────────────────────────
if $UPLOAD_ENV; then
  echo "→ Uploading .env …"
  scp "$LOCAL/.env" "$SERVER:$REMOTE/.env"
fi

# ── 3. Install deps + restart on server ──────────────────────────────────────
echo "→ Installing deps and restarting on server …"
ssh "$SERVER" bash <<EOF
  set -e
  cd "$REMOTE"

  # install / update deps only if package-lock changed
  npm ci --omit=dev --silent

  # start or reload apps via ecosystem config
  if pm2 id dashboard > /dev/null 2>&1; then
    pm2 reload ecosystem.config.cjs --only dashboard --update-env
  else
    pm2 start ecosystem.config.cjs --only dashboard
  fi

  if $RESTART_BOT; then
    if pm2 id job-alert-bot > /dev/null 2>&1; then
      pm2 reload ecosystem.config.cjs --only job-alert-bot --update-env
    else
      pm2 start ecosystem.config.cjs --only job-alert-bot
    fi
  fi

  pm2 save --force
  echo "✓ Deploy complete"
EOF
