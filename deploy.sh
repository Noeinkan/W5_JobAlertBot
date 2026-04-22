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

  # Return the pm2 status of an app, or empty string if not registered.
  app_status() {
    pm2 jlist | node -e "const d=JSON.parse(require('fs').readFileSync(0));const a=d.find(x=>x.name==='\$1');process.stdout.write(a?a.pm2_env.status:'');"
  }

  # Reload an app, or if it's errored/stopped, delete and start fresh so env
  # changes take effect (pm2 reload --update-env doesn't always apply to errored procs).
  deploy_app() {
    local name="\$1"
    local status
    status=\$(app_status "\$name")
    if [ -z "\$status" ]; then
      pm2 start ecosystem.config.cjs --only "\$name"
    elif [ "\$status" = "errored" ] || [ "\$status" = "stopped" ]; then
      echo "  ⚠ \$name was \$status — deleting and starting fresh"
      pm2 delete "\$name"
      pm2 start ecosystem.config.cjs --only "\$name"
    else
      pm2 reload ecosystem.config.cjs --only "\$name" --update-env
    fi
  }

  # Fail loudly if an app isn't online after a short settle time.
  verify_app() {
    local name="\$1"
    sleep 3
    local status
    status=\$(app_status "\$name")
    if [ "\$status" != "online" ]; then
      echo "✗ \$name status: '\$status' — deploy FAILED"
      pm2 logs "\$name" --lines 20 --nostream --err || true
      exit 1
    fi
    echo "  ✓ \$name online"
  }

  deploy_app dashboard
  if $RESTART_BOT; then
    deploy_app job-alert-bot
  fi

  pm2 save --force

  echo "→ Verifying …"
  verify_app dashboard
  if $RESTART_BOT; then
    verify_app job-alert-bot
  fi

  echo "✓ Deploy complete"
EOF
