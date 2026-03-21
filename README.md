# Job Alert Discord Bot

Discord bot in Node.js that monitors UK job boards, deduplicates results in SQLite, and posts new jobs to a Discord channel.

## Features

- Discord notifications via rich embeds
- Scheduled runs every 6 hours in Europe/London time
- SQLite deduplication across Adzuna, Reed, and Serper
- Slash commands for manual search, stats, ping, and health
- Graceful degradation when a source fails
- Search query reload from `data/searches.json` on every run, so you can change queries without restarting the bot
- Retry policy for transient HTTP failures
- File logging in `logs/job-alert-bot.log`
- PM2 ecosystem file and optional systemd unit for VPS deployments
- Simple one-shot mode that can send directly to Discord with a webhook

## Requirements

- Node.js 20+
- npm
- Discord bot token and target channel
- At least one enabled job source API key

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy the environment template:

```bash
cp .env.example .env
```

3. Fill in your credentials in `.env`.

For the simplest setup, use a Discord webhook URL and at least one job source API key.

## API Registration Links

- Adzuna: https://developer.adzuna.com/
- Reed: https://www.reed.co.uk/developers/jobseeker
- Serper.dev: https://serper.dev/
- Discord Developer Portal: https://discord.com/developers/applications

## Running Locally

```bash
npm start
```

If you want a simple local run that searches once and posts directly into `#general`, use a Discord webhook and run:

```bash
npm run once
```

In that mode the script:

- runs one search cycle immediately
- sends any new jobs to the Discord webhook channel
- exits when finished

Per validare il progetto in locale prima di avviarlo:

```bash
npm run check
npm test
```

The bot will:

- connect to Discord
- register slash commands (`/search`, `/stats`, `/ping`, `/health`)
- initialize the SQLite database at `data/jobs.db`
- send a startup message showing the next scheduled run

## Simplest Discord Setup

If the full bot setup feels excessive, use a channel webhook instead:

1. Open your Discord server
2. Open the target channel, for example `#general`
3. Edit Channel > Integrations > Webhooks
4. Create a webhook
5. Copy the webhook URL
6. Put it into `.env` as `DISCORD_WEBHOOK_URL`
7. Run `npm run once`

With webhook mode you do not need:

- `DISCORD_TOKEN`
- `DISCORD_CHANNEL_ID`
- slash commands

Webhook mode is ideal if you only want to launch a search manually from your computer and push results into one channel.

## Scheduling

The cron schedule is fixed to these London-time slots:

- 01:00
- 07:00
- 13:00
- 19:00

Timezone handling uses `Europe/London`.

## Search Queries

Search definitions live in `data/searches.json`.

The file now supports richer configuration, including:

- `enabled`: disable a search without deleting it
- `keywords`: array form for cleaner query editing
- `tags`: custom embed hashtags
- `allowed_sources`: limit a search to specific providers
- `exclude_keywords`: remove noisy matches after fetch
- `contract_only`: keep only contract-style roles
- `source_options`: source-specific overrides like Adzuna category or Serper location

You can still keep the old simple format, but the richer JSON structure is preferable for maintenance.

The bot reloads this file every time a run starts, so changes take effect on the next scheduled run or the next `/search` command without restarting the process.

## Commands

- `/search`: trigger an immediate job search
- `/stats`: show total jobs found, jobs found today, jobs by source, and jobs by search query
- `/ping`: check whether the bot is responsive and show heartbeat
- `/health`: show runtime status, enabled sources, next run, and last run summary

If `DISCORD_GUILD_ID` is configured, slash commands are registered at guild level for faster updates. Otherwise they are registered globally.

## Automated Tests

The test suite uses Node's built-in test runner and covers:

- salary parsing and contract detection
- search filtering rules (`contract_only`, `exclude_keywords`, allowed sources)
- SQLite deduplication behavior

Run it with:

```bash
npm test
```

## Deployment With PM2

On your Hetzner VPS:

```bash
npm install
pm2 start ecosystem.config.cjs
pm2 save
```

Useful PM2 commands:

```bash
pm2 logs job-alert-bot
pm2 restart job-alert-bot
pm2 status
```

The repository includes [ecosystem.config.cjs](ecosystem.config.cjs) with production-friendly restart and log settings.

## Optional systemd Deployment

If you prefer systemd instead of PM2, use the unit template in [deploy/job-alert-bot.service](deploy/job-alert-bot.service) and adjust:

- `User`
- `WorkingDirectory`
- `ExecStart`
- `EnvironmentFile`

Then install it on Ubuntu:

```bash
sudo cp deploy/job-alert-bot.service /etc/systemd/system/job-alert-bot.service
sudo systemctl daemon-reload
sudo systemctl enable --now job-alert-bot
sudo systemctl status job-alert-bot
```

## Notes On Sources

- Adzuna and Reed are queried on every run when credentials are present.
- Serper results are cached in memory for a configurable time window to reduce paid API usage.
- If a source fails because of auth, rate limiting, or temporary downtime, the bot logs the error and continues with the remaining sources.
- Transient HTTP failures are retried with backoff according to `.env` values.

## Logging

- Application logs are written to `logs/job-alert-bot.log`
- PM2 logs are written to `logs/pm2-out.log` and `logs/pm2-error.log`
- The optional systemd unit appends to `logs/systemd-out.log` and `logs/systemd-error.log`

## Production Notes

- Set `STARTUP_RUN_ON_BOOT=true` if you want an immediate scan after process restart
- Keep `SERPER_CACHE_MINUTES` fairly high to reduce paid API usage
- Consider restricting some searches with `allowed_sources` if one source returns too much noise
- Review the log file regularly for API auth failures or rate limiting

## Database

The bot stores state in SQLite:

- `jobs`: deduped job listings already seen
- `run_log`: per-source per-search run statistics

The database file is created automatically at `data/jobs.db`.