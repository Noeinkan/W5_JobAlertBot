#!/usr/bin/env bash
# deploy.sh — copy local code to Hetzner and restart pm2 apps
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
    --bot|--all) RESTART_BOT=true ;;
  esac
done

# ── 1. Ensure remote directory exists ────────────────────────────────────────
echo "→ Preparing remote directory …"
ssh "$SERVER" "mkdir -p $REMOTE/logs $REMOTE/data"

# ── 2. Upload source files ────────────────────────────────────────────────────
echo "→ Uploading code …"
scp -r "$LOCAL/src"                  "$SERVER:$REMOTE/"
scp -r "$LOCAL/data"                 "$SERVER:$REMOTE/"
scp -r "$LOCAL/test"                 "$SERVER:$REMOTE/"
scp    "$LOCAL/package.json"         "$SERVER:$REMOTE/"
scp    "$LOCAL/package-lock.json"    "$SERVER:$REMOTE/"
scp    "$LOCAL/ecosystem.config.cjs" "$SERVER:$REMOTE/"

# ── 3. Optionally upload .env ─────────────────────────────────────────────────
if $UPLOAD_ENV; then
  echo "→ Uploading .env …"
  scp "$LOCAL/.env" "$SERVER:$REMOTE/.env"
fi

# ── 4. Install deps + restart on server ──────────────────────────────────────
echo "→ Installing deps and restarting on server …"
ssh "$SERVER" bash <<EOF
  set -e
  cd "$REMOTE"

  npm ci --omit=dev --silent

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
