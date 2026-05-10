import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { appConfig } from './config.js';
import { ensureJobsSchema } from './jobs-schema.js';

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
        notified,
        description,
        salary_text,
        rag_rating,
        rag_score,
        rag_reason,
        rag_matches,
        seniority_passed,
        salary_passed,
        filter_reason,
        remote_type,
        contract_length_months,
        sectors,
        clearances,
        tech_tools,
        years_experience,
        has_bonus,
        bonus_percent,
        car_allowance,
        pension_percent,
        has_equity
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
        0,
        @description,
        @salary_text,
        @rag_rating,
        @rag_score,
        @rag_reason,
        @rag_matches,
        @seniority_passed,
        @salary_passed,
        @filter_reason,
        @remote_type,
        @contract_length_months,
        @sectors,
        @clearances,
        @tech_tools,
        @years_experience,
        @has_bonus,
        @bonus_percent,
        @car_allowance,
        @pension_percent,
        @has_equity
      )
    `),
    updateExtractionStatement: db.prepare(`
      UPDATE jobs
      SET
        salary_min = @salary_min,
        salary_max = @salary_max,
        salary_text = @salary_text,
        is_contract = @is_contract,
        remote_type = @remote_type,
        contract_length_months = @contract_length_months,
        sectors = @sectors,
        clearances = @clearances,
        tech_tools = @tech_tools,
        years_experience = @years_experience,
        has_bonus = @has_bonus,
        bonus_percent = @bonus_percent,
        car_allowance = @car_allowance,
        pension_percent = @pension_percent,
        has_equity = @has_equity
      WHERE id = @id
    `),
    selectJobsForBackfillStatement: db.prepare(`
      SELECT id, title, description, salary_min, salary_max, salary_text, is_contract
      FROM jobs
      WHERE description IS NOT NULL AND description != ''
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
        posted_at,
        rag_rating,
        rag_score,
        rag_reason
      FROM jobs
      WHERE notified = 0
        AND filter_reason IS NULL
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
  ensureJobsSchema(db);
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
        description: job.description ?? null,
        salary_text: job.salaryText ?? null,
        rag_rating: job.ragRating ?? null,
        rag_score: Number.isFinite(job.ragScore) ? job.ragScore : null,
        rag_reason: job.ragReason ?? null,
        rag_matches: job.ragMatches != null ? JSON.stringify(job.ragMatches) : null,
        seniority_passed: job.seniorityPassed == null ? null : job.seniorityPassed ? 1 : 0,
        salary_passed: job.salaryPassed == null ? null : job.salaryPassed ? 1 : 0,
        filter_reason: job.filterReason ?? null,
        remote_type: job.remoteType ?? null,
        contract_length_months: Number.isFinite(job.contractLengthMonths) ? job.contractLengthMonths : null,
        sectors: Array.isArray(job.sectors) && job.sectors.length ? job.sectors.join('|') : null,
        clearances: Array.isArray(job.clearances) && job.clearances.length ? job.clearances.join('|') : null,
        tech_tools: Array.isArray(job.techTools) && job.techTools.length ? job.techTools.join('|') : null,
        years_experience: Number.isFinite(job.yearsExperience) ? job.yearsExperience : null,
        has_bonus: job.hasBonus ? 1 : 0,
        bonus_percent: Number.isFinite(job.bonusPercent) ? job.bonusPercent : null,
        car_allowance: Number.isFinite(job.carAllowance) ? job.carAllowance : null,
        pension_percent: Number.isFinite(job.pensionPercent) ? job.pensionPercent : null,
        has_equity: job.hasEquity ? 1 : 0,
      };

      const result = statements.insertJobStatement.run(normalized);
      return result.changes > 0;
    },
    updateExtraction(id, extraction) {
      statements.updateExtractionStatement.run({
        id,
        salary_min: Number.isFinite(extraction.salaryMin) ? extraction.salaryMin : null,
        salary_max: Number.isFinite(extraction.salaryMax) ? extraction.salaryMax : null,
        salary_text: extraction.salaryText ?? null,
        is_contract: extraction.isContract ? 1 : 0,
        remote_type: extraction.remoteType ?? null,
        contract_length_months: Number.isFinite(extraction.contractLengthMonths) ? extraction.contractLengthMonths : null,
        sectors: Array.isArray(extraction.sectors) && extraction.sectors.length ? extraction.sectors.join('|') : null,
        clearances: Array.isArray(extraction.clearances) && extraction.clearances.length ? extraction.clearances.join('|') : null,
        tech_tools: Array.isArray(extraction.techTools) && extraction.techTools.length ? extraction.techTools.join('|') : null,
        years_experience: Number.isFinite(extraction.yearsExperience) ? extraction.yearsExperience : null,
        has_bonus: extraction.hasBonus ? 1 : 0,
        bonus_percent: Number.isFinite(extraction.bonusPercent) ? extraction.bonusPercent : null,
        car_allowance: Number.isFinite(extraction.carAllowance) ? extraction.carAllowance : null,
        pension_percent: Number.isFinite(extraction.pensionPercent) ? extraction.pensionPercent : null,
        has_equity: extraction.hasEquity ? 1 : 0,
      });
    },
    getJobsWithDescription() {
      return statements.selectJobsForBackfillStatement.all();
    },
    getAllJobsForDashboard() {
      return db.prepare(`
        SELECT
          found_at,
          source,
          search_id,
          title,
          company,
          location,
          salary_text,
          salary_min,
          salary_max,
          is_contract,
          url,
          posted_at,
          notified,
          filter_reason,
          rag_rating,
          rag_score,
          rag_reason,
          remote_type,
          contract_length_months,
          sectors,
          clearances,
          tech_tools,
          years_experience,
          has_bonus,
          bonus_percent,
          car_allowance,
          pension_percent,
          has_equity
        FROM jobs
        ORDER BY found_at DESC, id DESC
      `).all();
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
        ragRating: job.rag_rating,
        ragScore: job.rag_score,
        ragReason: job.rag_reason,
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

export function updateExtraction(id, extraction) {
  return defaultDatabase.updateExtraction(id, extraction);
}

export function getJobsWithDescription() {
  return defaultDatabase.getJobsWithDescription();
}

export function getAllJobsForDashboard() {
  return defaultDatabase.getAllJobsForDashboard();
}
