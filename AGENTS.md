# AGENTS.md

Node.js ESM Discord bot that aggregates UK jobs from 24 sources, scores/filters them, stores in SQLite, posts Discord alerts, and optionally serves a dashboard.

## Context

- `CLAUDE.md` — canonical project reference (sources, schema, commands, runtime modes, production).
- `.cursor/rules/job-alert-bot.mdc` — Cursor project rules.
- `tools/rtk-bootstrap/README.md` — RTK Copilot bootstrap utility.

## Common commands

- `npm start` — dashboard on port 3099 (auto-opens browser)
- `npm run bot` — persistent Discord bot (scheduler + alerts)
- `npm run once` — one-shot run
- `npm run dashboard` — dashboard only (alias of `npm start`)
- `npm run send-pending` — post already-stored, not-yet-notified jobs to Discord
- `npm run check` — syntax check
- `npm test` — test suite
- `npm run backfill:extractors` — backfill extraction columns
- `npm run backfill:posted-at` — normalize legacy `posted_at` values to ISO

## Conventions

- ESM throughout; Node.js 20+.
- Schema changes go in `src/jobs-schema.js` (shared by bot + dashboard).
- Fix shared behavior in `src/utils/`, not per-source adapters.
- One source failure must not abort the full fetch cycle.
- Prefix shell commands with `rtk` (e.g. `rtk git status`).

## Validation

```bash
rtk npm run check
rtk npm test
```

Run before declaring a change done.