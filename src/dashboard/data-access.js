/**
 * Dashboard SQLite access — read-only + dedicated writer for job actions.
 * Keep separate from src/db.js to avoid dual writers corrupting the WAL.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { appConfig, loadSearches } from '../config.js';
import { ensureJobsSchema } from '../jobs-schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const RUNS_DIR = path.join(__dirname, '..', '..', 'logs', 'runs');
export const CHART_BUNDLE = path.join(__dirname, '..', '..', 'node_modules', 'chart.js', 'dist', 'chart.umd.js');
export const PUBLIC_DIR = path.join(__dirname, 'public');
export const ALL_JOBS_ID = '__all__.csv';

let readonlyDb = null;
let readonlyStmt = null;

function ensureReadonlyDb() {
  ensureDashboardJobsMigrated();
  if (!readonlyDb) {
    readonlyDb = new Database(appConfig.dbPath, { readonly: true, fileMustExist: true });
  }
  return readonlyDb;
}

let writeDb = null;
export function getWriteDb() {
  if (!writeDb) {
    writeDb = new Database(appConfig.dbPath, { readonly: false, fileMustExist: true });
    ensureJobsSchema(writeDb);
  }
  return writeDb;
}

let dashboardJobsMigrated = false;
export function ensureDashboardJobsMigrated() {
  if (dashboardJobsMigrated) return;
  const db = new Database(appConfig.dbPath, { readonly: false, fileMustExist: true });
  try {
    ensureJobsSchema(db);
  } finally {
    db.close();
  }
  dashboardJobsMigrated = true;
}

export function getAllJobsForDashboard() {
  const db = ensureReadonlyDb();
  if (!readonlyStmt) {
    readonlyStmt = db.prepare(`
      SELECT
        found_at, source, search_id, title, company, location,
        salary_text, salary_min, salary_max, is_contract, url, posted_at,
        notified, filter_reason, rag_rating, rag_score, rag_reason,
        remote_type, contract_length_months, sectors, clearances, tech_tools,
        years_experience, has_bonus, bonus_percent, car_allowance,
        pension_percent, has_equity, applied, discarded, expired
      FROM jobs
      ORDER BY found_at DESC, id DESC
    `);
  }
  return readonlyStmt.all();
}

let previewStmt = null;
/**
 * Job description + highlight metadata for dashboard modal (unique key: title, company, source).
 */
export function getJobPreview(title, company, source) {
  const db = ensureReadonlyDb();
  if (!previewStmt) {
    previewStmt = db.prepare(`
      SELECT description, rag_matches, search_id, sectors, tech_tools, title, url
      FROM jobs
      WHERE title = ? AND source = ? AND company = ?
    `);
  }
  const row = previewStmt.get(String(title ?? ''), String(source ?? ''), String(company ?? ''));
  if (!row) return null;

  let ragMatches = null;
  if (row.rag_matches) {
    try {
      ragMatches = JSON.parse(row.rag_matches);
    } catch {
      ragMatches = null;
    }
  }

  const searches = loadSearches();
  const searchRow = searches.find((s) => s.id === row.search_id);
  const searchKeywords = searchRow?.keywords?.length ? [...searchRow.keywords] : [];

  return {
    title: row.title ?? '',
    url: row.url ?? '',
    description: row.description ?? '',
    rag_matches: ragMatches,
    search_keywords: searchKeywords,
    sectors: row.sectors ? String(row.sectors).split('|').map((t) => t.trim()).filter(Boolean) : [],
    tech_tools: row.tech_tools ? String(row.tech_tools).split('|').map((t) => t.trim()).filter(Boolean) : [],
  };
}

export function listCsvFiles() {
  const csvs = fs.existsSync(RUNS_DIR)
    ? fs.readdirSync(RUNS_DIR).filter(f => f.endsWith('.csv')).sort().reverse()
    : [];
  return [ALL_JOBS_ID, ...csvs];
}

/** Matches UNIQUE(title, company, source) / dashboard job-action UPDATE (company normalized to ''). */
export function makeJobKey(title, company, source) {
  return String(title ?? '') + '\0' + String(company ?? '') + '\0' + String(source ?? '');
}

/**
 * Map job identity → applied/discarded flags from SQLite (dashboard writes these via /api/job-action).
 * Used to overlay CSV run snapshots so Actions persist across reloads.
 */
export function getJobActionOverlayMap() {
  const db = ensureReadonlyDb();
  const rows = db.prepare(`
    SELECT title, COALESCE(company, '') AS company, source,
           COALESCE(applied, 0) AS applied, COALESCE(discarded, 0) AS discarded,
           COALESCE(expired, 0) AS expired
    FROM jobs
  `).all();
  const map = new Map();
  for (const row of rows) {
    map.set(makeJobKey(row.title, row.company, row.source), {
      applied: !!row.applied,
      discarded: !!row.discarded,
      expired: !!row.expired,
    });
  }
  return map;
}

export function rowFromDbJob(job) {
  const baseOutcome = job.filter_reason
    ? job.filter_reason
    : (job.notified ? 'new' : 'already_seen');
  const outcome = job.discarded
    ? 'discarded'
    : job.expired
      ? 'expired'
      : (job.applied ? 'applied' : baseOutcome);
  return {
    _baseOutcome: baseOutcome,
    run_at: job.found_at ?? '',
    trigger: 'db_all',
    search_id: job.search_id ?? '',
    search_name: job.search_id ?? '',
    source: job.source ?? '',
    title: job.title ?? '',
    company: job.company ?? '',
    location: job.location ?? '',
    salary_text: job.salary_text ?? '',
    salary_min: job.salary_min ?? '',
    salary_max: job.salary_max ?? '',
    is_contract: job.is_contract ? 'yes' : 'no',
    url: job.url ?? '',
    posted_at: job.posted_at ?? '',
    found_at: job.found_at ?? '',
    desc_chars: '',
    enriched: '',
    outcome,
    rag_rating: job.rag_rating ?? '',
    rag_score: job.rag_score ?? '',
    rag_reason: job.rag_reason ?? '',
    remote_type: job.remote_type ?? '',
    contract_length_months: job.contract_length_months ?? '',
    sectors: job.sectors ?? '',
    clearances: job.clearances ?? '',
    tech_tools: job.tech_tools ?? '',
    years_experience: job.years_experience ?? '',
    has_bonus: job.has_bonus ? 'yes' : '',
    bonus_percent: job.bonus_percent ?? '',
    car_allowance: job.car_allowance ?? '',
    pension_percent: job.pension_percent ?? '',
    has_equity: job.has_equity ? 'yes' : '',
    applied:   job.applied   ? '1' : '0',
    discarded: job.discarded ? '1' : '0',
    expired:   job.expired   ? '1' : '0',
  };
}
