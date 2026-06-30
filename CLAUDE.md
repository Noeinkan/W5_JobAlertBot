# CLAUDE.md

Node.js Discord bot for UK job alerts. Fetches from **25** sources (Adzuna, Reed, Serper, LinkedIn, Jooble, Careerjet, Guardian Jobs, JobServe, Construction Enquirer, CV-Library, Rise Technical, CIOB Jobs, BIM+ Jobs, Technojobs, Totaljobs, CWJobs, Hays, Michael Page, Matchtech, Morson, Advance TRS, ICE Recruit, Monster, Glassdoor) → normalizes → keyword relevance + **RAG** scoring + seniority/salary gates → description **enrichment** and structured **extraction** → deduplicates in SQLite → notifies Discord. Optional **web dashboard** (aggregates, charts, run logs, job actions) runs as a separate process.

## Stack

Node.js 20+, ESM, discord.js v14, better-sqlite3, axios, node-cron, dotenv, fast-xml-parser, **chart.js** (dashboard bundles).

## Key Files

| File | Purpose |
|---|---|
| `src/index.js` | Bootstrap, scheduling, fetch pipeline, slash commands |
| `src/config.js` | Env loading, search normalization, source enablement |
| `src/db.js` | Writer connection, inserts, pending jobs, dashboard listing helpers |
| `src/jobs-schema.js` | `jobs` / `run_log` DDL and **incremental column migrations** (shared with dashboard) |
| `src/discord.js` | Client, embeds, webhook, command registration |
| `src/sources/*.js` | **25** source adapters (see `src/index.js` `sourceClients`; shared helpers: `stepstone_platform.js`, `next_data_extract.js`, `browser.js` for JS-rendered pages) |
| `src/utils/http.js` | Retry helper |
| `src/utils/logger.js` | File and console logging |
| `src/utils/salary.js` | Salary parsing and contract detection |
| `src/utils/search.js` | Search and source filtering |
| `src/utils/seniority.js` | Seniority level detection |
| `src/utils/relevance.js` | Keyword relevance pre-filter (used inside adapters) |
| `src/utils/rag.js` | RAG rating/score/reason for job fit |
| `src/utils/enrich.js` | Description enrichment |
| `src/utils/extractors.js` | Structured signals (remote type, sectors, clearances, benefits, etc.) |
| `src/utils/run_log_csv.js` | Per-run CSV logs for the dashboard |
| `src/dashboard.js` | Dashboard entrypoint (host, token, base path) |
| `src/dashboard/server.js` | HTTP API, static UI, bot-control endpoints |
| `src/dashboard/data-access.js` | Read-only DB access + job row shaping for UI |
| `src/dashboard/aggregate.js` | Cached aggregates + merge **applied** / **discarded** from SQLite |
| `scripts/backfill-extractors.js` | Backfill extraction columns on existing rows |
| `data/searches.json` | Search definitions, reloaded on every run |
| `deploy.sh` | Deploy/sync helper (production workflow) |

## Runtime Modes

**Bot mode** (`DISCORD_TOKEN` + `DISCORD_CHANNEL_ID`): long-running; schedules runs at 01:00/07:00/13:00/19:00 Europe/London. Set `STARTUP_RUN_ON_BOOT=true` to run immediately on start.

**One-shot** (`DISCORD_WEBHOOK_URL` + `npm run once` or `RUN_ONCE=true`): single cycle then exits. Does not start the scheduler.

**Dashboard** (`npm run dashboard` → `node src/dashboard.js --port 3099`): separate HTTP server for analytics UI, run CSVs, and job table (not started by the bot). Env:

- `DASHBOARD_HOST` — bind address (default `127.0.0.1`; `0.0.0.0` for all interfaces).
- `DASHBOARD_TOKEN` — required when binding to a **non-loopback** host (refuses to listen otherwise). When set with a non-loopback bind, the token is enforced on **every** endpoint (not only bot-control). Callers must send `x-dashboard-token: <token>`; a reverse proxy can inject it.
- `DASHBOARD_BASE_PATH` — optional URL prefix when served behind a reverse proxy (no trailing slash).

## Commands

- `npm start` — bot mode  
- `npm run once` — one-shot mode  
- `npm run check` — syntax check (includes dashboard and schema-related modules)  
- `npm test` — test suite  
- `npm run dashboard` — dashboard server (default port **3099**)  
- `npm run backfill:extractors` — backfill extraction fields on existing DB rows  

## Data Model

**`jobs` table** — deduplication key: `(title, company, source)`. Tracks notification status, **RAG** and filter columns, **enrichment/extraction** fields, and dashboard-only **`applied` / `discarded`** flags (updated via dashboard API, merged into aggregates).

**`run_log` table** — per-source, per-search execution stats.

## Pipeline (mental model)

1. Each adapter returns the normalized job shape; many sources call `isRelevantJob` early.  
2. `index.js` runs seniority and salary checks, **`scoreJob` (RAG)**, then **`enrichJobDescription`** / **`extractJobSignals`** before `insertJob`.  
3. Pending Discord notifications: rows with `notified = 0` and `filter_reason IS NULL` (`getPendingJobs`).  
4. Dashboard uses a **read-only** SQLite connection where possible; writes **applied/discarded** via API.

## Normalized Job Shape

Adapters must return at least: `externalId`, `source`, `title`, `company`, `location`, `salaryMin`, `salaryMax`, `salaryText`, `isContract`, `url`, `postedAt`, `searchId`, `description`.

After scoring and extraction, persisted fields also include RAG (`ragRating`, `ragScore`, `ragReason`), filter outcomes (`seniorityPassed`, `salaryPassed`, `filterReason`), and extraction bundles (`remoteType`, `contractLengthMonths`, `sectors`, `clearances`, `techTools`, `yearsExperience`, bonus/equity fields — see `insertJob` in `src/db.js`).

## Notes

- Source failures must not abort the full cycle.  
- Pending jobs come from the DB, not only the current run.  
- Serper results are cached in memory (query + location).  
- **No API key:** LinkedIn, Careerjet, JobServe, Construction Enquirer, CV-Library, Rise Technical, CIOB Jobs, BIM+ Jobs, Technojobs, Totaljobs, CWJobs, Hays, Michael Page, Matchtech, Morson, Advance TRS, ICE Recruit.  
- **Credentials:** Adzuna, Reed, Serper, Jooble, Guardian Jobs; optional Monster (OAuth), Glassdoor (partner keys).  
- Guild-scoped slash commands only when `DISCORD_GUILD_ID` is set.  
- Searches normalized in `src/config.js` — keep in sync with `data/searches.json` schema.

## Production

- **URL:** `https://jobs.noeinsolutions.com` (HTTP Basic Auth at the nginx layer; nginx injects the dashboard token).
- **Host:** `root@77.42.70.26`. Bot code lives at `/opt/job-alert-bot`; deploy with `bash deploy.sh`.
- **Dashboard runtime:** PM2 (`pm2 list` → `dashboard` + `job-alert-bot`). Bound to `0.0.0.0:3099` per `ecosystem.config.cjs`; the global token guard prevents anonymous direct access.
- **Reverse proxy:** the nginx that serves `noeinsolutions.com` lives in the **`bep-generator` docker-compose stack** at `/opt/bep-generator`, not in the bot repo. The `jobs.noeinsolutions.com` vhost is bind-mounted from `/opt/bep-generator/nginx/conf.d/jobs.conf`; basic-auth credentials at `/opt/bep-generator/nginx/htpasswd`. Nginx reaches the dashboard via `host.docker.internal:3099` (declared via `extra_hosts: host-gateway` in compose).
- **TLS:** Let's Encrypt issued via `certbot --webroot -w /var/www/certbot`; `/etc/letsencrypt` is bind-mounted into the nginx container. Auto-renewal via certbot's systemd timer.
- **Gotcha — Docker bind-mounted files track inode, not path.** `scp` and `sed -i` replace files via temp+rename, breaking the mount silently — the container keeps reading the old content. When editing prod nginx conf, either use `cat new > target` (preserves inode) or recreate the container with `docker compose up -d --force-recreate nginx`.

## Development

- Minimal changes, consistent ESM style.  
- Fix shared behavior in `src/utils/`, not per-source.  
- Update `README.md` for setup/env/mode/search changes.  
- Update tests for salary parsing, filtering, DB behavior.  
- Schema changes belong in `src/jobs-schema.js` so both bot and dashboard migrate consistently.

## Validation

```bash
npm run check && npm test
```

Inspect DB state:

```bash
node --input-type=module -e "import { getPendingJobs, getStats } from './src/db.js'; console.log(JSON.stringify({ pendingJobs: getPendingJobs().length, stats: getStats() }, null, 2));"
```
