# Job Alert Discord Bot

Node.js bot that searches UK job sources, deduplicates results in SQLite, and sends new matches to Discord.

## What It Does

- Queries Adzuna, Reed, Serper, LinkedIn, Jooble, Careerjet, Guardian Jobs, JobServe, Construction Enquirer, and CV-Library for job listings
- LinkedIn, Careerjet, JobServe, Construction Enquirer, and CV-Library require no API key
- Filters jobs for seniority level and keyword relevance before inserting
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

- `ADZUNA_APP_ID` + `ADZUNA_APP_KEY` — required for Adzuna
- `REED_API_KEY` — required for Reed
- `SERPER_API_KEY` — required for Serper
- `JOOBLE_API_KEY` — optional; email api@jooble.org for a free key. Aggregates Totaljobs, CV-Library, CWJobs, and 100+ UK boards
- `GUARDIAN_API_KEY` — optional; free key from open-platform.theguardian.com. Good for public sector digital/BIM roles
- LinkedIn, Careerjet, JobServe, Construction Enquirer, and CV-Library require no API key and are always enabled

### Runtime Tuning

- `SERPER_CACHE_MINUTES`: in-memory Serper cache TTL, default `360`
- `API_DELAY_MS`: delay between source requests, default `1000`
- `HTTP_MAX_RETRIES`: retry attempts for transient failures, default `3`
- `HTTP_RETRY_DELAY_MS`: base retry delay in milliseconds, default `1500`
- `LOG_LEVEL`: logger level, default `info`
- `STARTUP_RUN_ON_BOOT`: run one search cycle on startup, default `false`
- `RUN_ONCE`: alternate flag for one-shot execution, default `false`

### Profile fit (CV-aligned second score)

Each job can be scored against [`data/profile.json`](data/profile.json) after the lexicon RAG pass. Jobs with **Profile Red** are stored with `filter_reason = filtered_profile` and are **not** notified on Discord. The lexicon RAG columns (`rag_*`) stay independent so you can compare both layers in the dashboard.

- `PROFILE_FIT_ENABLED`: **on by default** (unset or empty). Set to `false`, `0`, `no`, or `off` to disable CV-aligned scoring for the bot process.
- `PROFILE_FIT_PATH`: optional path to an alternate profile JSON (defaults to `data/profile.json` relative to the project root)
- `PROFILE_FIT_STRICT`: set to `true`, `1`, `yes`, or `on` so **only Profile Green** jobs can notify on Discord — **Profile Amber** is treated like Red (`filtered_profile_strict`). Default: off (Amber still notifies).

The **dashboard** shows a **Profile fit** strip at the top (north star, config path, on/off, strict mode) and table columns **Profile** / **Prof score** / **Prof reason** ahead of lexicon RAG when viewing runs or all jobs.

Edit [`data/profile.json`](data/profile.json) to match your CV. **Lexicon RAG** (`rag_*` columns) and **profile fit** (`profile_*`) are independent layers.

**Schema (version 2):**

| Field | Meaning |
|--------|---------|
| `northStar` | Short narrative of your target roles — not scored; echoed in dashboard/job metadata for context. |
| `dimensions` | Optional map of dimension ids to `{ label }` for documentation only. |
| `aliases` | Map of alias keys to arrays of regex strings; patterns may use `"aliasOf": "key"` instead of repeating regex. |
| `positivePatterns` / `titlePositivePatterns` | Body vs title-only positives; each row: `pattern` **or** `aliasOf`, `weight`, `label`, `dimension` (default `general`), `tier` (`preferred` \| `required`). |
| `negativePatterns` / `titleNegativePatterns` | Same as before; optional `unless` rescue regex list. |
| `aggregation` | `capPerDimension` (max points per dimension from positives), `vetoNegativeTotalBelow` (force Red if combined negatives ≤ threshold), `requireAtLeastOnePositiveInDimensions` (all listed ids must have a positive hit for **Green**), `missingRequiredDimensionsRating` (`Amber` or `Red` when that gate fails). |

Omitted keys keep legacy behaviour: no caps, no veto, no dimension gate.

## API Registration Links

- Adzuna: https://developer.adzuna.com/
- Reed: https://www.reed.co.uk/developers/jobseeker
- Serper: https://serper.dev/
- Jooble: email api@jooble.org to request a free key
- Guardian: https://open-platform.theguardian.com/access/
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

## Run Dashboard

Start the dashboard server:

```bash
node src/dashboard.js --port 3099
```

The dashboard visualizations are scoped to the currently selected CSV file in `logs/runs/`.

New analytics panels include:

- source quality funnel
- outcomes over sequence (within selected CSV)
- filter pareto
- search effectiveness heatmap
- source reliability snapshot
- SPC control view (notified)
- throughput progression
- schedule heatmap
- relevance score scatter

Each chart header includes a `?` hover/focus help tip with:

- what the visual shows
- why it matters
- how to interpret signals

A glossary panel also explains terms such as `filtered_match`, `RAG`, control limits, and source reliability.

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
- `allowed_sources`: subset of `adzuna`, `reed`, `serper`, `linkedin`, `jooble`, `careerjet`, `guardian`, `jobserve`, `construction_enquirer`, `cvlibrary`
- `exclude_keywords`: post-fetch content filter
- `distance_from_location`: used by Reed
- `source_options`: source-specific overrides

Example:

```json
{
	"defaults": {
		"location": "London",
		"distance_from_location": 10,
		"allowed_sources": ["adzuna", "reed", "serper", "linkedin", "jooble", "careerjet", "guardian", "jobserve", "construction_enquirer", "cvlibrary"],
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
			"allowed_sources": ["adzuna", "reed", "serper", "linkedin", "jooble", "careerjet", "guardian", "jobserve", "construction_enquirer", "cvlibrary"],
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
- LinkedIn, Careerjet, JobServe, Construction Enquirer, and CV-Library scrape public listings — no API key required
- Jooble aggregates 100+ UK boards including Totaljobs, CWJobs, and CV-Library
- Guardian Jobs is suited to public sector and digital roles
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
		adzuna.js                  Adzuna fetcher
		careerjet.js               Careerjet fetcher (no API key)
		construction_enquirer.js   Construction Enquirer fetcher (no API key)
		cvlibrary.js               CV-Library fetcher (no API key)
		guardian.js                Guardian Jobs fetcher
		jobserve.js                JobServe fetcher (no API key)
		jooble.js                  Jooble fetcher
		linkedin.js                LinkedIn fetcher (no API key)
		reed.js                    Reed fetcher
		serper.js                  Serper fetcher with in-memory cache
	utils/
		http.js          Retry helper
		logger.js        File and console logging
		relevance.js     Keyword relevance scoring
		salary.js        Salary parsing and contract detection
		search.js        Search and source filtering helpers
		seniority.js     Seniority level detection
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