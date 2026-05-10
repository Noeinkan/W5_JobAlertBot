# Job Alert Bot — Product Overview

## What It Is

A self-hosted Discord bot that monitors 11 UK job boards and delivers relevant, deduplicated job alerts directly into a Discord channel. Built for professionals tracking niche or senior roles in specialist fields (e.g. BIM, Digital Construction, Information Management) where manual job board searching is repetitive and time-consuming.

## Problem It Solves

Senior and specialist roles in construction and digital engineering appear across many different job boards, often at different times. Checking each board manually is slow, results overlap, and it is easy to miss a posting before it closes. This bot automates the search, removes duplicates, and surfaces only new matches — delivered on a schedule or on demand.

## Who It Is For

Individuals actively or passively searching for senior roles (e.g. BIM Manager, Head of Digital, Digital Delivery Lead) who want timely alerts without paying for job board subscriptions or checking multiple sites daily. Also useful for recruiters or team leads monitoring a specific niche.

## Core Features

### Multi-Source Aggregation

Fetches from 20 job sources in a single run:

| Source | Key Required |
|---|---|
| Adzuna | Yes |
| Reed | Yes |
| Serper (Google Jobs) | Yes |
| Jooble | Yes (free) |
| Guardian Jobs | Yes (free) |
| LinkedIn | No |
| Careerjet | No |
| JobServe | No |
| Construction Enquirer | No |
| CV-Library | No |
| Rise Technical | No |
| CIOB Jobs | No |
| BIM+ Jobs | No |
| Technojobs | No |
| Totaljobs | No |
| CWJobs | No |
| Hays | No |
| Michael Page | No |
| Monster | Yes (partner OAuth) |
| Glassdoor | Yes (partner API) |

### Deduplication

Jobs are deduplicated in SQLite by `(title, company, source)`. A job seen again from the same source on a later run will not generate a second notification.

### Intelligent Filtering

Before a job is stored or notified:

- **Seniority filtering** — removes graduate, junior, and trainee-level roles automatically
- **RAG quality scoring** — scores each job Green / Amber / Red against a weighted keyword matrix covering title seniority, AEC domain relevance, experience signals, and negative indicators. Red-rated jobs are suppressed; Green and Amber are notified with their rating shown in the Discord embed
- **Keyword relevance scoring** — ranks and filters results by how closely they match the search intent
- **Contract detection** — identifies and flags contract vs. permanent roles from salary text and job title patterns
- **Salary parsing** — extracts and normalises salary ranges from free-text descriptions
- **Exclude keywords** — per-search content filter to suppress irrelevant results (e.g. "junior", "trainee")
- **Page enrichment** — optionally fetches the full job detail page to give the RAG scorer richer description text (enabled per-search via `enrich_jobs: true`)

### Flexible Search Configuration

Searches are defined in `data/searches.json` and reloaded on every run — no restart needed to add or modify a search. Each search supports:

- Multiple keyword phrases
- Location and radius
- Minimum salary threshold
- Contract-only mode
- Per-source overrides (e.g. different Adzuna category per search)
- Source allowlist (limit which boards a specific search hits)

### Two Delivery Modes

**Bot mode** — long-running process. Schedules four runs per day at 01:00, 07:00, 13:00, and 19:00 (Europe/London). Supports Discord slash commands for on-demand control.

**One-shot mode** — runs a single cycle via webhook and exits. Suitable for cron jobs, CI pipelines, or manual use.

### Discord Slash Commands

| Command | What It Does |
|---|---|
| `/search` | Triggers an immediate search cycle |
| `/stats` | Shows total jobs found, by source and by search |
| `/health` | Shows runtime state, enabled sources, last/next run |
| `/ping` | Shows Discord heartbeat latency and bot uptime |

### Reliability

- Source failures do not abort the full run — the bot continues with remaining sources and logs the failure
- Transient HTTP errors are retried with configurable backoff
- Pending (unfailed) notifications are re-attempted on the next run if delivery fails mid-cycle
- Serper results are cached in memory to reduce paid API usage

## How It Works

```
searches.json
      |
      v
[Fetch from sources in parallel]
      |
      v
[Normalize to common job shape]
      |
      v
[Filter: seniority + relevance + exclude keywords]
      |
      v
[Optional: enrich description from job detail page]
      |
      v
[RAG score: Green / Amber / Red — drop Red]
      |
      v
[Deduplicate in SQLite]
      |
      v
[Send new jobs as Discord embeds (colour-coded by RAG rating)]
      |
      v
[Mark as notified in DB]
```

## Deployment Options

- **Local** — `npm start` for bot mode, `npm run once` for one-shot
- **PM2** — `pm2 start ecosystem.config.cjs`, with restart and log management
- **systemd** — service unit in `deploy/job-alert-bot.service` for Linux servers

## Tech Stack

- **Runtime**: Node.js 20+, ESM modules
- **Discord**: discord.js v14
- **Database**: better-sqlite3 (SQLite)
- **HTTP**: axios with retry helper
- **Scheduling**: node-cron
- **Config**: dotenv
- **XML parsing**: fast-xml-parser (for RSS-based sources)

## Discord Embed Appearance

Each notified job is a colour-coded embed:

| RAG Rating | Colour | Title |
|---|---|---|
| Green | Green | `🟢 GREEN MATCH` |
| Amber | Orange | `🟡 AMBER MATCH` |

Contract roles append `· CONTRACT` to the title. The embed body shows the RAG score and the matching signals (e.g. `Title: Head of · Domain: BIM, ISO 19650 · Experience: Line management`).

## Companion Tool — job-match CLI

`job-match/` is a standalone Python CLI that uses the Claude API to deeply analyse a single job against a candidate profile YAML. Use it to manually evaluate a shortlisted job after the bot surfaces it.

```bash
# Analyse a URL
job-match match "https://reed.co.uk/jobs/..."

# Paste text from clipboard (recommended for LinkedIn)
job-match match --text

# Batch mode
job-match batch urls.txt --output results.json
```

Output includes an `overall_score` (0–100), per-dimension scores (skills fit, seniority, location, salary), missing skills, strong matches, and a verdict (`STRONG_MATCH`, `GOOD_MATCH`, etc.). Results are cached by URL hash.

## Constraints and Trade-offs

- LinkedIn, Careerjet, JobServe, Construction Enquirer, and CV-Library are scraped from public listings — no formal API, may break if site structure changes
- Serper is a paid Google Jobs proxy — cache TTL (`SERPER_CACHE_MINUTES`) should be kept high to control cost
- Page enrichment (`enrich_jobs: true`) increases run time and HTTP load — use selectively for high-value searches
- RAG scoring is heuristic-based — tune `GREEN_THRESHOLD` and `AMBER_THRESHOLD` in `src/utils/rag.js` if too many or too few jobs are suppressed
- Search configuration must stay in sync with `src/config.js` normalization logic
- No web UI — all interaction is through Discord or the command line
