/**
 * Jobs / run_log DDL and migrations. Imported by db.js and dashboard/data-access.js so the
 * dashboard can migrate an older SQLite file without importing db.js (which
 * opens the default writer connection at load time).
 */
export const JOB_COLUMN_ADDITIONS = [
  ['description', 'TEXT'],
  ['salary_text', 'TEXT'],
  ['rag_rating', 'TEXT'],
  ['rag_score', 'INTEGER'],
  ['rag_reason', 'TEXT'],
  ['rag_matches', 'TEXT'],
  ['profile_rating', 'TEXT'],
  ['profile_score', 'INTEGER'],
  ['profile_reason', 'TEXT'],
  ['profile_matches', 'TEXT'],
  ['seniority_passed', 'INTEGER'],
  ['salary_passed', 'INTEGER'],
  ['filter_reason', 'TEXT'],
  ['remote_type', 'TEXT'],
  ['contract_length_months', 'INTEGER'],
  ['sectors', 'TEXT'],
  ['clearances', 'TEXT'],
  ['tech_tools', 'TEXT'],
  ['years_experience', 'INTEGER'],
  ['has_bonus', 'INTEGER'],
  ['bonus_percent', 'INTEGER'],
  ['car_allowance', 'REAL'],
  ['pension_percent', 'INTEGER'],
  ['has_equity', 'INTEGER'],
  ['applied', 'INTEGER'],
  ['discarded', 'INTEGER'],
  ['expired', 'INTEGER'],
];

export function ensureJobsSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      external_id TEXT,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      company TEXT,
      location TEXT,
      salary_min REAL,
      salary_max REAL,
      url TEXT NOT NULL,
      search_id TEXT,
      is_contract BOOLEAN DEFAULT 0,
      posted_at TEXT,
      found_at TEXT NOT NULL DEFAULT (datetime('now')),
      notified BOOLEAN DEFAULT 0,
      description TEXT,
      salary_text TEXT,
      rag_rating TEXT,
      rag_score INTEGER,
      rag_reason TEXT,
      seniority_passed INTEGER,
      salary_passed INTEGER,
      filter_reason TEXT,
      UNIQUE(title, company, source)
    );

    CREATE TABLE IF NOT EXISTS run_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ran_at TEXT NOT NULL DEFAULT (datetime('now')),
      source TEXT,
      search_id TEXT,
      results_found INTEGER,
      new_jobs INTEGER
    );
  `);

  const existing = new Set(db.prepare('PRAGMA table_info(jobs)').all().map((row) => row.name));
  for (const [name, type] of JOB_COLUMN_ADDITIONS) {
    if (!existing.has(name)) {
      db.exec(`ALTER TABLE jobs ADD COLUMN ${name} ${type}`);
    }
  }
}
