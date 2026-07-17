// One-off backfill: rewrite legacy posted_at values that aren't ISO 8601 into
// ISO, so the dashboard's date filter/sort and chart bucketing parse them
// correctly. Reed historically stored UK-style DD/MM/YYYY (see src/sources/reed.js,
// now fixed at ingest); other sources may have written stray formats too.
//
// Usage:
//   node scripts/backfill-posted-at.js --dry-run   # report only
//   node scripts/backfill-posted-at.js             # apply
import Database from 'better-sqlite3';
import { appConfig } from '../src/config.js';
import { normalizePostedAt } from '../src/utils/dates.js';

const DRY_RUN = process.argv.includes('--dry-run');
const ISO_PREFIX_RE = /^\d{4}-\d{2}-\d{2}/;

function run() {
  const db = new Database(appConfig.dbPath);
  const rows = db
    .prepare("SELECT id, posted_at FROM jobs WHERE posted_at IS NOT NULL AND posted_at != ''")
    .all();

  const update = db.prepare('UPDATE jobs SET posted_at = ? WHERE id = ?');
  let changed = 0;
  let unparseable = 0;

  const apply = db.transaction((candidates) => {
    for (const { id, next } of candidates) update.run(next, id);
  });

  const candidates = [];
  for (const row of rows) {
    const cur = String(row.posted_at).trim();
    if (ISO_PREFIX_RE.test(cur)) continue; // already ISO — leave untouched
    const next = normalizePostedAt(cur);
    if (next === cur || !ISO_PREFIX_RE.test(String(next))) {
      unparseable += 1;
      console.log(`[backfill] #${row.id} left as-is (unrecognized): "${cur}"`);
      continue;
    }
    changed += 1;
    console.log(`[backfill]${DRY_RUN ? '[dry]' : ''} #${row.id} "${cur}" → "${next}"`);
    candidates.push({ id: row.id, next });
  }

  if (!DRY_RUN && candidates.length) apply(candidates);
  db.close();

  console.log(
    `[backfill] done. ${DRY_RUN ? 'would rewrite' : 'rewrote'} ${changed} rows, ` +
      `${unparseable} left as-is, ${rows.length} scanned`
  );
}

run();
