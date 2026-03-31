# Job Alert Discord Bot

Node.js bot that searches UK job sources, deduplicates results in SQLite, and sends new matches to Discord.

## What It Does

- Queries Adzuna, Reed, and Serper when the related credentials are present
- Deduplicates jobs in SQLite before notifying Discord
- Supports scheduled runs in bot mode and manual one-shot runs in webhook mode
- Reloads `data/searches.json` at the start of every run
- Exposes slash commands for search, stats, ping, and health
- Retries transient HTTP failures and continues when a single source fails
- Writes application logs to `logs/job-alert-bot.log`

## Delivery Modes

### 1. Discord Bot Mode

Use this mode when you want:

- scheduled runs
- slash commands
- a startup status message
- a persistent process managed by Node, PM2, or systemd

Required environment variables:

- `DISCORD_TOKEN`
- `DISCORD_CHANNEL_ID`
- at least one source credential

Optional:

- `DISCORD_GUILD_ID` for faster slash command updates during development
- `DISCORD_WEBHOOK_URL` if you also want webhook delivery available

### 2. Webhook One-Shot Mode

Use this mode when you want a simple manual run that posts into a Discord channel and exits.

Required environment variables:

- `DISCORD_WEBHOOK_URL`
- at least one source credential

Start it with:

```bash
npm run once
```

Important: webhook-only configuration does not start the long-running scheduler. In this repository, scheduled runs are started only after the Discord bot client becomes ready.

## Requirements

- Node.js 20+
- npm
- one or more job source API credentials
- either Discord bot credentials or a Discord webhook URL

## Setup

1. Install dependencies.

```bash
npm install
```

2. Create `.env` from the template.

PowerShell:

```powershell
Copy-Item .env.example .env
```

Bash:

```bash
cp .env.example .env
```

3. Fill in the values in `.env`.

## Environment Variables

### Discord

- `DISCORD_TOKEN`: bot token for persistent bot mode
- `DISCORD_CHANNEL_ID`: text channel used for alerts and startup messages
- `DISCORD_GUILD_ID`: optional guild id for guild-scoped command registration
- `DISCORD_WEBHOOK_URL`: optional webhook URL, required for `npm run once`

### Sources

- `ADZUNA_APP_ID`
- `ADZUNA_APP_KEY`
- `REED_API_KEY`
- `SERPER_API_KEY`
- `JOOBLE_API_KEY` — optional; email api@jooble.org to request a free key. Aggregates Totaljobs, CV-Library, CWJobs, and 100+ UK boards
- `GUARDIAN_API_KEY` — optional; free key from open-platform.theguardian.com. Good for public sector digital/BIM roles

### Runtime Tuning

- `SERPER_CACHE_MINUTES`: in-memory Serper cache TTL, default `360`
- `API_DELAY_MS`: delay between source requests, default `1000`
- `HTTP_MAX_RETRIES`: retry attempts for transient failures, default `3`
- `HTTP_RETRY_DELAY_MS`: base retry delay in milliseconds, default `1500`
- `LOG_LEVEL`: logger level, default `info`
- `STARTUP_RUN_ON_BOOT`: run one search cycle on startup, default `false`
- `RUN_ONCE`: alternate flag for one-shot execution, default `false`

## API Registration Links

- Adzuna: https://developer.adzuna.com/
- Reed: https://www.reed.co.uk/developers/jobseeker
- Serper: https://serper.dev/
- Discord Developer Portal: https://discord.com/developers/applications

## Local Usage

### Start the persistent bot

```bash
npm start
```

This mode:

- logs into Discord
- registers slash commands
- initializes `data/jobs.db`
- schedules runs at fixed London-time slots
- optionally runs immediately if `STARTUP_RUN_ON_BOOT=true`

### Run a one-shot search

```bash
npm run once
```

This mode:

- runs a single search cycle immediately
- sends pending jobs to the configured webhook
- exits when finished

### Validate locally

```bash
npm run check
npm test
```

## Slash Commands

- `/search`: run an immediate search cycle
- `/stats`: show totals, jobs found today, jobs by source, and jobs by search id
- `/ping`: show Discord heartbeat and bot uptime
- `/health`: show runtime state, enabled sources, next run, and last run summary

If `DISCORD_GUILD_ID` is set, commands are registered at guild scope. Otherwise they are registered globally.

## Schedule

The schedule is fixed in code to `Europe/London` at:

- 01:00
- 07:00
- 13:00
- 19:00

## Search Configuration

Searches are stored in `data/searches.json`.

Supported fields:

- `id`: stable identifier used in stats and stored jobs
- `name`: human-readable search name
- `enabled`: disable a search without deleting it
- `keywords`: array of search phrases
- `location`: source query location
- `min_salary`: minimum salary filter
- `contract_only`: keep only roles detected as contract roles
- `tags`: hashtags added to embeds
- `allowed_sources`: subset of `adzuna`, `reed`, `serper`
- `exclude_keywords`: post-fetch content filter
- `distance_from_location`: used by Reed
- `source_options`: source-specific overrides

Example:

```json
{
	"defaults": {
		"location": "London",
		"distance_from_location": 10,
		"allowed_sources": ["adzuna", "reed", "serper"],
		"exclude_keywords": [],
		"tags": []
	},
	"searches": [
		{
			"id": "contract_bim",
			"name": "Contract BIM roles",
			"enabled": true,
			"keywords": ["BIM Manager contract", "Information Manager contract infrastructure"],
			"contract_only": true,
			"allowed_sources": ["adzuna", "reed", "serper"],
			"exclude_keywords": ["graduate", "junior", "trainee"],
			"source_options": {
				"adzuna": {
					"category": "it-jobs"
				},
				"serper": {
					"location": "London, UK",
					"gl": "uk"
				}
			}
		}
	]
}
```

Notes:

- the file is reloaded at the start of every run
- disabled searches are ignored
- jobs are filtered again after source fetch using `contract_only` and `exclude_keywords`

## Source Behavior

- Adzuna uses `what` or `what_or` based on the number of keywords and supports `what_exclude`
- Reed uses `distance_from_location` and `minimumSalary`
- Serper responses are cached in memory for `SERPER_CACHE_MINUTES`
- if a source fails, the run continues and the failure is logged in `run_log`

## Notification Semantics

- jobs are inserted into SQLite before notification
- notifications are sent from the set of pending, not-yet-notified jobs
- if delivery fails part-way through a run, pending jobs remain in the database and can be delivered on a later successful run

## Database

The SQLite database is created automatically at `data/jobs.db`.

Tables:

- `jobs`: deduplicated job listings with notification state
- `run_log`: per-source and per-search execution stats

## Logging

- application log: `logs/job-alert-bot.log`
- PM2 logs: `logs/pm2-out.log` and `logs/pm2-error.log`
- optional systemd logs: `logs/systemd-out.log` and `logs/systemd-error.log`

## Tests

The project uses Node's built-in test runner.

Current coverage includes:

- salary parsing and contract detection
- search filtering rules
- SQLite deduplication behavior

Run tests with:

```bash
npm test
```

## Project Structure

```text
src/
	config.js          Environment parsing and search loading
	db.js              SQLite schema and persistence helpers
	discord.js         Discord client, embeds, webhook helpers, slash commands
	index.js           Runtime orchestration and scheduler
	sources/
		adzuna.js        Adzuna fetcher
		reed.js          Reed fetcher
		serper.js        Serper fetcher with in-memory cache
	utils/
		http.js          Retry helper
		logger.js        File and console logging
		salary.js        Salary parsing and contract detection
		search.js        Search and source filtering helpers
data/
	searches.json      Search definitions
	jobs.db            SQLite database created at runtime
test/
	*.test.js          Node test files
```

## Deployment With PM2

```bash
npm install
pm2 start ecosystem.config.cjs
pm2 save
```

Useful commands:

```bash
pm2 logs job-alert-bot
pm2 restart job-alert-bot
pm2 status
```

The repository includes `ecosystem.config.cjs` with restart and log settings.

## Optional systemd Deployment

Use `deploy/job-alert-bot.service` as a starting point and adjust:

- `User`
- `WorkingDirectory`
- `ExecStart`
- `EnvironmentFile`

Install on Ubuntu:

```bash
sudo cp deploy/job-alert-bot.service /etc/systemd/system/job-alert-bot.service
sudo systemctl daemon-reload
sudo systemctl enable --now job-alert-bot
sudo systemctl status job-alert-bot
```

## Operational Notes

- keep `SERPER_CACHE_MINUTES` reasonably high to reduce paid usage
- review `logs/job-alert-bot.log` for auth issues and rate limits
- prefer narrowing noisy searches with `allowed_sources`, `exclude_keywords`, or source-specific options
- set `STARTUP_RUN_ON_BOOT=true` if you want an immediate scan after restart