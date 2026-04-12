import fs from 'node:fs';
import path from 'node:path';
import { appConfig } from '../config.js';

const HEADERS = [
  'run_at',
  'trigger',
  'search_id',
  'search_name',
  'source',
  'title',
  'company',
  'location',
  'salary_text',
  'salary_min',
  'salary_max',
  'is_contract',
  'url',
  'posted_at',
  'desc_chars',
  'enriched',
  'outcome',
  'rag_rating',
  'rag_score',
  'rag_reason',
];

function escape(value) {
  if (value == null) return '';
  const str = String(value);
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Creates a per-run CSV log file in logs/runs/.
 * Returns { append(row), filePath }.
 */
export function createRunCsvLog(trigger) {
  const runsDir = path.join(appConfig.logsDir, 'runs');
  fs.mkdirSync(runsDir, { recursive: true });

  const runAt = new Date().toISOString();
  const stamp = runAt.replace(/[:.]/g, '-').slice(0, 19);
  const filePath = path.join(runsDir, `run_${stamp}_${trigger}.csv`);

  fs.writeFileSync(filePath, HEADERS.join(',') + '\n', 'utf8');

  return {
    filePath,
    append(row) {
      const values = HEADERS.map((h) => escape(h === 'run_at' ? runAt : row[h]));
      fs.appendFileSync(filePath, values.join(',') + '\n', 'utf8');
    },
  };
}
