# CLAUDE.md

Node.js Discord bot for UK job alerts. Fetches from Adzuna, Reed, Serper, LinkedIn, Jooble, Careerjet, Guardian Jobs, JobServe, Construction Enquirer, and CV-Library → normalizes → deduplicates in SQLite → notifies Discord.

## Stack

Node.js 20+, ESM, discord.js v14, better-sqlite3, axios, node-cron, dotenv, fast-xml-parser

## Key Files

| File | Purpose |
|---|---|
| `src/index.js` | bootstrap, scheduling, slash commands |
| `src/config.js` | env loading, search normalization, source enablement |
| `src/db.js` | schema, insert/stats helpers, pending job retrieval |
| `src/discord.js` | client, embeds, webhook, command registration |
| `src/sources/*.js` | source adapters (10 sources) |
| `src/utils/http.js` | retry helper |
| `src/utils/logger.js` | file and console logging |
| `src/utils/salary.js` | salary parsing and contract detection |
| `src/utils/search.js` | search and source filtering |
| `src/utils/seniority.js` | seniority level detection |
| `src/utils/relevance.js` | keyword relevance scoring |
| `data/searches.json` | search definitions, reloaded on every run |

## Runtime Modes

**Bot mode** (`DISCORD_TOKEN` + `DISCORD_CHANNEL_ID`): long-running, schedules runs at 01:00/07:00/13:00/19:00 Europe/London. Set `STARTUP_RUN_ON_BOOT=true` to run immediately on start.

**One-shot** (`DISCORD_WEBHOOK_URL` + `npm run once` or `RUN_ONCE=true`): single cycle then exits. Does not start the scheduler.

## Commands

- `npm start` — bot mode
- `npm run once` — one-shot mode
- `npm run check` — syntax check
- `npm test` — test suite

## Data Model

**`jobs` table** — deduplication key: `(title, company, source)`. Tracks notification status.
**`run_log` table** — per-source, per-search execution stats.

## Normalized Job Shape

All source adapters must return: `externalId`, `source`, `title`, `company`, `location`, `salaryMin`, `salaryMax`, `salaryText`, `isContract`, `url`, `postedAt`, `searchId`, `description`.

## Notes

- Source failures must not abort the full cycle
- Pending jobs come from the DB, not only the current run
- Serper results are cached in memory (query + location)
- LinkedIn, Careerjet, JobServe, Construction Enquirer, and CV-Library require no API key
- Adzuna, Reed, Serper, Jooble, and Guardian Jobs require credentials
- Jobs are filtered for seniority via `src/utils/seniority.js` after source fetch
- Guild-scoped slash commands only when `DISCORD_GUILD_ID` is set
- Searches normalized in `src/config.js` — keep in sync with `data/searches.json` schema

## Development

- Minimal changes, consistent ESM style
- Fix shared behavior in utils, not per-source
- Update `README.md` for setup/env/mode/search changes
- Update tests for salary parsing, filtering, DB behavior

## Validation

```bash
npm run check && npm test
# inspect DB state:
node --input-type=module -e "import { getPendingJobs, getStats } from './src/db.js'; console.log(JSON.stringify({ pendingJobs: getPendingJobs().length, stats: getStats() }, null, 2));"
```