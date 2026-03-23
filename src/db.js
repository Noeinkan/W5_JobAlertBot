import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { appConfig } from './config.js';

function createSchema(db) {
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
}

function createStatements(db) {
  return {
    insertJobStatement: db.prepare(`
      INSERT OR IGNORE INTO jobs (
        external_id,
        source,
        title,
        company,
        location,
        salary_min,
        salary_max,
        url,
        search_id,
        is_contract,
        posted_at,
        notified
      ) VALUES (
        @external_id,
        @source,
        @title,
        @company,
        @location,
        @salary_min,
        @salary_max,
        @url,
        @search_id,
        @is_contract,
        @posted_at,
        0
      )
    `),
    markNotifiedStatement: db.prepare(`
      UPDATE jobs
      SET notified = 1
      WHERE source = ?
        AND title = ?
        AND company = ?
    `),
    insertRunLogStatement: db.prepare(`
      INSERT INTO run_log (source, search_id, results_found, new_jobs)
      VALUES (?, ?, ?, ?)
    `),
    totalJobsStatement: db.prepare('SELECT COUNT(*) AS count FROM jobs'),
    jobsBySourceStatement: db.prepare(`
      SELECT source, COUNT(*) AS count
      FROM jobs
      GROUP BY source
      ORDER BY count DESC, source ASC
    `),
    jobsBySearchStatement: db.prepare(`
      SELECT search_id, COUNT(*) AS count
      FROM jobs
      GROUP BY search_id
      ORDER BY count DESC, search_id ASC
    `),
    jobsTodayStatement: db.prepare(`
      SELECT COUNT(*) AS count
      FROM jobs
      WHERE found_at >= ?
        AND found_at < ?
    `),
    pendingJobsStatement: db.prepare(`
      SELECT
        external_id,
        source,
        title,
        company,
        location,
        salary_min,
        salary_max,
        url,
        search_id,
        is_contract,
        posted_at
      FROM jobs
      WHERE notified = 0
      ORDER BY found_at ASC, id ASC
    `),
    jobsTodayListStatement: db.prepare(`
      SELECT title, company, source
      FROM jobs
      WHERE found_at >= ?
        AND found_at < ?
      ORDER BY found_at ASC
    `),
  };
}

function getLondonDayBounds() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: appConfig.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === 'year')?.value ?? '0');
  const month = Number(parts.find((part) => part.type === 'month')?.value ?? '1') - 1;
  const day = Number(parts.find((part) => part.type === 'day')?.value ?? '1');
  const start = new Date(Date.UTC(year, month, day, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, day + 1, 0, 0, 0));

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

export function createDatabase(databasePath = appConfig.dbPath) {
  if (databasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }

  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  createSchema(db);
  const statements = createStatements(db);

  return {
    insertJob(job) {
      const normalized = {
        external_id: job.externalId ?? null,
        source: job.source,
        title: job.title.trim(),
        company: (job.company ?? '').trim(),
        location: job.location ?? '',
        salary_min: Number.isFinite(job.salaryMin) ? job.salaryMin : null,
        salary_max: Number.isFinite(job.salaryMax) ? job.salaryMax : null,
        url: job.url,
        search_id: job.searchId ?? null,
        is_contract: job.isContract ? 1 : 0,
        posted_at: job.postedAt ?? null,
      };

      const result = statements.insertJobStatement.run(normalized);
      return result.changes > 0;
    },
    markJobNotified(job) {
      statements.markNotifiedStatement.run(job.source, job.title.trim(), (job.company ?? '').trim());
    },
    logRun({ source, searchId, resultsFound, newJobs }) {
      statements.insertRunLogStatement.run(source, searchId, resultsFound, newJobs);
    },
    getStats() {
      const bounds = getLondonDayBounds();

      return {
        totalJobs: statements.totalJobsStatement.get().count,
        jobsToday: statements.jobsTodayStatement.get(bounds.start, bounds.end).count,
        bySource: statements.jobsBySourceStatement.all(),
        bySearch: statements.jobsBySearchStatement.all(),
      };
    },
    getJobsToday() {
      const bounds = getLondonDayBounds();
      return statements.jobsTodayListStatement.all(bounds.start, bounds.end);
    },
    getPendingJobs() {
      return statements.pendingJobsStatement.all().map((job) => ({
        externalId: job.external_id,
        source: job.source,
        title: job.title,
        company: job.company,
        location: job.location,
        salaryMin: job.salary_min,
        salaryMax: job.salary_max,
        url: job.url,
        searchId: job.search_id,
        isContract: Boolean(job.is_contract),
        postedAt: job.posted_at,
      }));
    },
    close() {
      db.close();
    },
  };
}

const defaultDatabase = createDatabase();

export function insertJob(job) {
  return defaultDatabase.insertJob(job);
}

export function markJobNotified(job) {
  return defaultDatabase.markJobNotified(job);
}

export function logRun(run) {
  return defaultDatabase.logRun(run);
}

export function getStats() {
  return defaultDatabase.getStats();
}

export function getJobsToday() {
  return defaultDatabase.getJobsToday();
}

export function getPendingJobs() {
  return defaultDatabase.getPendingJobs();
}
