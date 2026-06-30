---
name: sync-claude-context
description: Keep the Claude-facing context files (README.md, CLAUDE.md, .claude/project-index.md) and auto-memory in sync with the codebase. Can run after a session or as a full audit based on recent git history. Does NOT touch docs/ (use update-docs) or CHANGELOG.md (use update-changelog).
---

# Sync Claude Context

Run after session work **or** as a standalone audit to catch drift between the codebase and the files that give Claude (and new contributors) their mental model of the project: `README.md`, `CLAUDE.md`, `.claude/project-index.md`, plus auto-memory.

Only update when the change is real and durable — not for in-progress or experimental work.

For sister skills covering other doc surfaces, see [update-docs](../update-docs/SKILL.md) (long-form `docs/` tree) and [update-changelog](../update-changelog/SKILL.md) (`CHANGELOG.md`).

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
- After adding a new module, page, route, context, service, or hook
- After renaming/removing a significant file or directory
- After changing architectural patterns or critical gotchas
- After adding/removing npm packages or environment variables
- After any change that would make the current docs misleading
- Periodically (e.g. after 10+ commits) to catch accumulated drift

## Decision rules per document

### `README.md`
Update when:
- New user-facing features or modules are added
- Setup steps change (new env vars, new services, new commands)
- The stack changes (new dependency category, removed tool)
- Port numbers or service topology changes

Do NOT update for: internal refactors, bug fixes, test-only changes, style tweaks.

### `CLAUDE.md`
Update when:
- A new critical gotcha is discovered (async/sync trap, import restriction, invariant)
- A new module section is needed (mirrors existing sections like EIR, OIR, DC Manager)
- A new config file is added that future Claude instances must know about
- A convention changes (e.g. new naming pattern, new barrel import rule)
- A new context is introduced (`*Context`, `use*` hook with global scope)
- Directory structure changes in a way that makes the Layout section wrong

Do NOT update for: implementation details already visible from the code, one-off fixes.

### `.claude/project-index.md`
Update when:
- A new directory is created under `src/` or `server/` with a distinct purpose
- A new API route group is added (new prefix like `/api/capability-assessments`)
- A new React context or hook with cross-component scope is introduced
- A new schema file is added to `src/schemas/`
- A new service file is added to `server/services/` or `src/services/`
- An existing entry becomes inaccurate (wrong path, wrong description)

Do NOT update for: changes within an already-indexed directory that don't alter its purpose description.

---

## Steps

1. **Collect changes**
   - *Session mode:* list every file created, modified, or deleted in this conversation. Group by: new, changed, deleted.
   - *Git mode:* run `git log --oneline -20`. For commits not yet reflected in docs, run `git show --stat <sha>` to get file lists. Summarise each commit in one line.

2. **Filter noise** — drop from consideration: `*.test.*`, `*.spec.*`, `build/`, `node_modules/`, formatting-only diffs, and reverts of already-audited commits.

3. **Evaluate each document** — for each of the three docs, apply the decision rules above. Output a one-line verdict:
   - `README.md: UPDATE — reason` or `README.md: SKIP — reason`
   - `CLAUDE.md: UPDATE — reason` or `CLAUDE.md: SKIP — reason`
   - `project-index.md: UPDATE — reason` or `project-index.md: SKIP — reason`

4. **Read before editing** — for each doc marked UPDATE, read the current file first. Never overwrite content that is still accurate.

5. **Apply minimal edits** — add or update only the sections affected. Do not reformat, reorganise, or expand unrelated sections. Use the existing style and heading level.

6. **Verify** — after edits, re-read the changed sections and confirm they are accurate and consistent with each other (e.g. a new route in project-index should match any mention in CLAUDE.md).

7. **Update auto-memory** — if the audit surfaced a new critical pattern, gotcha, or non-obvious invariant not already in memory, add or update the relevant entry in `~/.claude/projects/c--Users-andre-Downloads-W3-capsar-io/memory/`. Skip if nothing new was learned.

---

## What never changes
- Do not alter the "Token optimization" or "Commands" sections in CLAUDE.md unless the commands themselves changed.
- Do not change the project-index architecture diagram unless ports or services actually changed.
- Do not add speculative or "planned" content — only document what exists now.
