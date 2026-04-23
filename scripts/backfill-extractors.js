import { getJobsWithDescription, updateExtraction } from '../src/db.js';
import { extractJobSignals } from '../src/utils/extractors.js';

const DRY_RUN = process.argv.includes('--dry-run');

function summarize(extraction) {
  const parts = [];
  if (Number.isFinite(extraction.salaryMin) || Number.isFinite(extraction.salaryMax)) {
    parts.push(extraction.salaryText);
  }
  if (extraction.sectors?.length) parts.push(`sectors=${extraction.sectors.join(',')}`);
  if (extraction.clearances?.length) parts.push(`clearances=${extraction.clearances.join(',')}`);
  if (extraction.techTools?.length) parts.push(`tools=${extraction.techTools.slice(0, 3).join(',')}${extraction.techTools.length > 3 ? '…' : ''}`);
  if (Number.isFinite(extraction.yearsExperience)) parts.push(`${extraction.yearsExperience}y exp`);
  if (extraction.remoteType) parts.push(extraction.remoteType);
  if (Number.isFinite(extraction.contractLengthMonths)) parts.push(`${extraction.contractLengthMonths}mo`);
  return parts.join(' · ') || '(no signals)';
}

function run() {
  const rows = getJobsWithDescription();
  console.log(`[backfill] found ${rows.length} rows with non-empty description`);

  let updated = 0;
  let salaryGained = 0;

  for (const row of rows) {
    const extraction = extractJobSignals({
      title: row.title,
      description: row.description,
      salaryTextHint: row.salary_text,
    });

    if (!Number.isFinite(row.salary_min) && !Number.isFinite(row.salary_max)
        && (Number.isFinite(extraction.salaryMin) || Number.isFinite(extraction.salaryMax))) {
      salaryGained += 1;
    }

    if (DRY_RUN) {
      console.log(`[backfill][dry] #${row.id} ${row.title.slice(0, 60)} → ${summarize(extraction)}`);
    } else {
      updateExtraction(row.id, extraction);
    }
    updated += 1;

    if (updated % 100 === 0) {
      console.log(`[backfill] processed ${updated}/${rows.length}`);
    }
  }

  console.log(`[backfill] done. ${DRY_RUN ? 'would update' : 'updated'} ${updated} rows, ${salaryGained} gained salary data`);
}

run();
