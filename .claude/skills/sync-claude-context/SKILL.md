---
name: sync-claude-context
description: Keep the Claude-facing context files (README.md, CLAUDE.md, AGENTS.md) and auto-memory in sync with the codebase. Can run after a session or as a full audit based on recent git history.
---

# Sync Claude Context

Run after session work **or** as a standalone audit to catch drift between the codebase and the files that give Claude (and new contributors) their mental model of the project: `README.md`, `CLAUDE.md`, `AGENTS.md`, plus auto-memory.

Only update when the change is real and durable — not for in-progress or experimental work.

This repo has no `docs/` tree and no `CHANGELOG.md`: these three files plus `.cursor/rules/job-alert-bot.mdc` are the whole documentation surface.

## Modes

### A — Session sync (default)
Used right after you finish a task. Base the audit on the files you created/modified/deleted in the current conversation.

### B — Git history audit
Used standalone or when the codebase has moved ahead of the docs. Run:
```
git log --oneline -20
```
to get the last 20 commits. For each commit that touches code (not just docs/tests/style), inspect what changed:
```
git show --stat <sha>
```
Then apply the decision rules below to those changes. Skip commits that are purely: test-only, style/format, comment/docs, or revert of another commit already audited.

**Tip:** Run both modes together — start with the git audit, then layer in anything from the current session that isn't committed yet.

---

## When to run
- After adding or removing a source adapter in `src/sources/`
- After adding a module under `src/utils/`, `src/dashboard/`, or `scripts/`
- After a schema change in `src/jobs-schema.js` (new column, new table)
- After adding or removing a dashboard HTTP endpoint
- After adding/removing npm packages, npm scripts, or environment variables
- After changing the production topology (PM2, nginx, ports, bind address)
- After any change that would make the current docs misleading
- Periodically (e.g. after 10+ commits) to catch accumulated drift

## Decision rules per document

### `README.md`
Update when:
- New user-facing features or runtime modes are added
- Setup steps change (new env vars, new credentials, new commands)
- The stack changes (new dependency category, removed tool)
- Port numbers, bind address, or dashboard auth behaviour changes

Do NOT update for: internal refactors, bug fixes, test-only changes, style tweaks.

### `CLAUDE.md`
This file is **always loaded**, in every session and every subagent. Every line is paid for repeatedly, so it earns its place only if a change would break silently without it.

Update when:
- A new critical gotcha is discovered (sync-only `better-sqlite3`, inode-tracking bind mounts, ESM-only imports)
- The **Key Files** table becomes wrong — a listed file moved, or a new file owns a responsibility the table claims elsewhere
- The source count changes — the number in the intro line and in the `src/sources/*.js` row must both match `sourceClients` in `src/index.js`
- The normalized job shape or a persisted field set changes
- A runtime mode, npm script, or env var changes
- Production topology changes (host, PM2 process names, nginx vhost, TLS)

Do NOT update for: implementation details already visible from the code, one-off fixes, or a new file that fits an existing table row.

### `AGENTS.md`
The short entry point for non-Claude agents; some tools read only this file. It restates a subset of `CLAUDE.md` on purpose — keep the overlap consistent rather than removing it.

Update when:
- An npm script is added, removed, or renamed
- A convention in the Conventions list changes
- The source count changes (must match `CLAUDE.md`)
- The validation command changes

Do NOT update for: anything that only affects the detail sections of `CLAUDE.md`.

---

## Steps

1. **Collect changes**
   - *Session mode:* list every file created, modified, or deleted in this conversation. Group by: new, changed, deleted.
   - *Git mode:* run `git log --oneline -20`. For commits not yet reflected in docs, run `git show --stat <sha>` to get file lists. Summarise each commit in one line.

2. **Filter noise** — drop from consideration: `*.test.*`, `test/`, formatting-only diffs, `data/`, `logs/`, and reverts of already-audited commits.

3. **Evaluate each document** — for each of the three docs, apply the decision rules above. Output a one-line verdict:
   - `README.md: UPDATE — reason` or `README.md: SKIP — reason`
   - `CLAUDE.md: UPDATE — reason` or `CLAUDE.md: SKIP — reason`
   - `AGENTS.md: UPDATE — reason` or `AGENTS.md: SKIP — reason`

4. **Read before editing** — for each doc marked UPDATE, read the current file first. Never overwrite content that is still accurate.

5. **Apply minimal edits** — add or update only the sections affected. Do not reformat, reorganise, or expand unrelated sections. Use the existing style and heading level.

6. **Verify claims against the code, not against the other doc.** Every number, path, and command you write must come from a file you opened in this session:
   - source count → the `sourceClients` array in `src/index.js`
   - npm scripts → the `scripts` block in `package.json`
   - file paths → the filesystem
   - ports and bind defaults → `src/dashboard.js` and `ecosystem.config.cjs`

   Then confirm `CLAUDE.md` and `AGENTS.md` agree with each other where they overlap.

7. **Update auto-memory** — if the audit surfaced a new critical pattern, gotcha, or non-obvious invariant not already in memory, add or update the relevant entry in `~/.claude/projects/c--Users-andre-Downloads-W5-JobAlertBot/memory/`. Skip if nothing new was learned.

---

## What never changes
- Do not alter the "Commands" section in `CLAUDE.md` unless `package.json` scripts actually changed.
- Do not add rows to the `CLAUDE.md` Key Files table for files that fit an existing row — the table maps responsibilities, not the filesystem.
- Do not add speculative or "planned" content — only document what exists now.
