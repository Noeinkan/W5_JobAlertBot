---
name: rotate-dashboard-token
description: Generate a new DASHBOARD_TOKEN on the production server (77.42.70.26), update /opt/job-alert-bot/.env, reload the dashboard via PM2, and print the new token. Use when the user asks to rotate, regenerate, or reset the dashboard token.
---

# Rotate dashboard token

Run this single command via Bash:

```bash
ssh root@77.42.70.26 'set -e
NEW_TOKEN=$(openssl rand -hex 24)
sed -i "s|^DASHBOARD_TOKEN=.*|DASHBOARD_TOKEN=$NEW_TOKEN|" /opt/job-alert-bot/.env
pm2 reload dashboard --update-env > /dev/null
echo "$NEW_TOKEN"'
```

Then print the returned token to the user in this exact form:

```
New token: <value>
```

Followed by this reminder (one line):
> In the browser DevTools console on the dashboard, run `localStorage.removeItem('dashboardToken')` and refresh — it will prompt for the new value.

Do nothing else. Do not commit, do not modify local files, do not open the dashboard.
