import fs from 'fs';
import {
  getAllJobsForDashboard,
  getJobActionOverlayMap,
  makeJobKey,
  rowFromDbJob,
} from './data-access.js';

// ── CSV parser ────────────────────────────────────────────────────────────────
function parseCsv(raw) {
  const lines = raw.trim().split('\n');
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const vals = splitCsvLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (vals[i] ?? '').trim(); });
    return obj;
  });
}

function splitCsvLine(line) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

const AGG_CACHE_LIMIT = 50;
const aggregateCache = new Map();

export function invalidateAggregateCache(filename) {
  aggregateCache.delete(filename);
}

/** Clear cached aggregates (e.g. after job-action updates SQLite — CSV files do not change on disk). */
export function invalidateAllAggregateCaches() {
  aggregateCache.clear();
}

/**
 * Merge persisted applied/discarded from SQLite into CSV snapshot rows (same keys as /api/job-action).
 */
function applyJobActionOverlay(rows, overlayMap) {
  for (const r of rows) {
    const csvOutcome = r.outcome;
    r._baseOutcome = csvOutcome;
    const o = overlayMap.get(makeJobKey(r.title, r.company, r.source));
    if (!o) {
      r.applied = '0';
      r.discarded = '0';
      r.expired = '0';
      continue;
    }
    r.applied = o.applied ? '1' : '0';
    r.discarded = o.discarded ? '1' : '0';
    r.expired = o.expired ? '1' : '0';
    if (o.discarded) r.outcome = 'discarded';
    else if (o.expired) r.outcome = 'expired';
    else if (o.applied) r.outcome = 'applied';
    else r.outcome = csvOutcome;
  }
}

function getAggregate(filePath, filename) {
  const stat = fs.statSync(filePath);
  const cached = aggregateCache.get(filename);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    aggregateCache.delete(filename);
    aggregateCache.set(filename, cached);
    return cached.data;
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = parseCsv(raw);
  applyJobActionOverlay(parsed, getJobActionOverlayMap());
  const data = aggregate(parsed);
  aggregateCache.set(filename, { mtimeMs: stat.mtimeMs, data });
  if (aggregateCache.size > AGG_CACHE_LIMIT) {
    const oldest = aggregateCache.keys().next().value;
    aggregateCache.delete(oldest);
  }
  return data;
}

export function getCsvAggregate(filePath, filename) {
  return getAggregate(filePath, filename);
}

// ── Contract rate detection + yearly equivalent ───────────────────────────────
const BILLABLE_DAYS = 220;
const HOURS_PER_DAY = 7.5;
const COST_RATE     = 0.225;

function toYearly(rateMin, rateMax, type) {
  const gross = v => type === 'day' ? v * BILLABLE_DAYS : v * HOURS_PER_DAY * BILLABLE_DAYS;
  const net   = v => Math.round(gross(v) * (1 - COST_RATE));
  const fmt   = v => `£${Math.round(v / 1000)}k`;

  const hasMax = rateMax && rateMax !== rateMin && rateMax < 10000;
  const grossMin = gross(rateMin);
  const netMin   = net(rateMin);

  if (hasMax) {
    const netMax = net(rateMax);
    return {
      yearlyGross: `${fmt(gross(rateMin))}–${fmt(gross(rateMax))} gross/yr`,
      yearlyNet:   `${fmt(netMin)}–${fmt(netMax)} net equiv`,
      yearlyNetMin: netMin,
      yearlyNetMax: netMax,
    };
  }
  return {
    yearlyGross: `${fmt(grossMin)} gross/yr`,
    yearlyNet:   `${fmt(netMin)} net equiv`,
    yearlyNetMin: netMin,
    yearlyNetMax: netMin,
  };
}

const EMPTY_RATE = { rateType: '', rateDisplay: '', yearlyGross: '', yearlyNet: '', yearlyNetMin: 0, yearlyNetMax: 0 };

function detectRate(row) {
  if (row.is_contract !== 'yes') return EMPTY_RATE;
  const text = (row.salary_text || '').toLowerCase();
  const min  = Number(row.salary_min);
  const max  = Number(row.salary_max);
  if (!min || min <= 0) return EMPTY_RATE;

  let type = '';
  if (/\/day|per day|p\/d|\bday\b/.test(text))           type = 'day';
  else if (/\/hour|\/hr|per hour|p\/h|\bhour/.test(text)) type = 'hour';
  else if (min < 100)  type = 'hour';
  else if (min < 2000) type = 'day';

  if (!type) return EMPTY_RATE;

  const unit   = type === 'day' ? '/day' : '/hr';
  const hasMax = max && max !== min && max < 10000;
  const display = hasMax ? `£${min}–£${max}${unit}` : `£${min}${unit}`;

  return { rateType: type, rateDisplay: display, ...toYearly(min, max, type) };
}

export function aggregate(rows) {
  const byOutcome = {};
  const bySource  = {};
  const bySearch  = {};
  const byRag     = {};
  const byProfile = {};
  const salaryVals = [];

  const contractRates = { day: [], hour: [] };

  for (const r of rows) {
    byOutcome[r.outcome] = (byOutcome[r.outcome] || 0) + 1;
    bySource[r.source]   = (bySource[r.source]   || 0) + 1;
    const label = r.search_name || r.search_id || 'unknown';
    bySearch[label]      = (bySearch[label]      || 0) + 1;
    if (r.rag_rating)    byRag[r.rag_rating]     = (byRag[r.rag_rating] || 0) + 1;
    if (r.profile_rating) byProfile[r.profile_rating] = (byProfile[r.profile_rating] || 0) + 1;
    if (r.salary_min && Number(r.salary_min) > 0) salaryVals.push(Number(r.salary_min));

    const rate = detectRate(r);
    r.rateType    = rate.rateType;
    r.rateDisplay = rate.rateDisplay;
    r.yearlyGross = rate.yearlyGross;
    r.yearlyNet   = rate.yearlyNet;
    if (rate.rateType === 'day'  && Number(r.salary_min)) contractRates.day.push({ raw: Number(r.salary_min), netMin: rate.yearlyNetMin, netMax: rate.yearlyNetMax });
    if (rate.rateType === 'hour' && Number(r.salary_min)) contractRates.hour.push({ raw: Number(r.salary_min), netMin: rate.yearlyNetMin, netMax: rate.yearlyNetMax });
  }

  const salaryBuckets = { '<30k': 0, '30-50k': 0, '50-70k': 0, '70-100k': 0, '>100k': 0 };
  const bucketOf = v => {
    const k = v / 1000;
    if      (k < 30)  return '<30k';
    else if (k < 50)  return '30-50k';
    else if (k < 70)  return '50-70k';
    else if (k < 100) return '70-100k';
    else              return '>100k';
  };
  for (const v of salaryVals) salaryBuckets[bucketOf(v)]++;

  const byContract = { Perm: 0, Contract: 0 };
  for (const r of rows) {
    const n = Number(r.salary_min);
    r.salaryBucket = (n && n > 0) ? bucketOf(n) : '';
    r.jobType = r.is_contract === 'yes' ? 'Contract' : 'Perm';
    byContract[r.jobType]++;
  }

  return {
    total:         rows.length,
    notified:      rows.filter(r => r.outcome === 'new').length,
    alreadySeen:   rows.filter(r => r.outcome === 'already_seen').length,
    filtered:      rows.filter(r => r.outcome?.startsWith('filtered')).length,
    appliedCount:  rows.filter(r => r.outcome === 'applied').length,
    discardedCount:rows.filter(r => r.outcome === 'discarded').length,
    expiredCount:  rows.filter(r => r.outcome === 'expired').length,
    salaryCount: salaryVals.length,
    contractCount: byContract.Contract,
    permCount:     byContract.Perm,
    runAt:       rows[0]?.run_at  ?? '',
    trigger:     rows[0]?.trigger ?? '',
    byOutcome, bySource, bySearch, byRag, byProfile, salaryBuckets, byContract,
    contractRates,
    analytics: deriveAnalytics(rows, byOutcome),
    rows,
  };
}

function parseIsoDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getRowDate(row) {
  return parseIsoDate(row.posted_at) || parseIsoDate(row.run_at);
}

function makeBucketLabel(startDate, endDate, index) {
  if (startDate && endDate) {
    const fmt = d => d.toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return fmt(startDate) + '–' + fmt(endDate);
  }
  return 'Slice ' + (index + 1);
}

function buildSequenceBuckets(rows, bucketCount = 10) {
  if (!rows.length) return { labels: [], buckets: [] };
  const withDate = rows.map((row, i) => ({ row, index: i, date: getRowDate(row) }));
  const valid = withDate.filter(r => r.date);
  const useDates = valid.length >= Math.max(5, Math.floor(rows.length * 0.2));
  const labels = [];
  const buckets = [];

  if (useDates) {
    const minTs = Math.min(...valid.map(v => v.date.getTime()));
    const maxTs = Math.max(...valid.map(v => v.date.getTime()));
    const span = Math.max(1, maxTs - minTs);
    for (let i = 0; i < bucketCount; i++) {
      const startTs = minTs + (span * i / bucketCount);
      const endTs = minTs + (span * (i + 1) / bucketCount);
      labels.push(makeBucketLabel(new Date(startTs), new Date(endTs), i));
      buckets.push([]);
    }
    for (const item of withDate) {
      const ts = item.date ? item.date.getTime() : minTs;
      const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor(((ts - minTs) / span) * bucketCount)));
      buckets[idx].push(item.row);
    }
  } else {
    for (let i = 0; i < bucketCount; i++) {
      labels.push(makeBucketLabel(null, null, i));
      buckets.push([]);
    }
    withDate.forEach((item, i) => {
      const idx = Math.min(bucketCount - 1, Math.floor(i * bucketCount / rows.length));
      buckets[idx].push(item.row);
    });
  }

  return { labels, buckets };
}

function deriveAnalytics(rows, byOutcome) {
  const filteredEntries = Object.entries(byOutcome)
    .filter(([k]) => k.startsWith('filtered_'))
    .sort((a, b) => b[1] - a[1]);
  const filteredTotal = filteredEntries.reduce((sum, [, n]) => sum + n, 0) || 1;
  let cumulative = 0;
  const pareto = filteredEntries.map(([label, value]) => {
    cumulative += value;
    return { label, value, cumulativePct: Math.round((cumulative / filteredTotal) * 1000) / 10 };
  });

  const sourceMap = {};
  const searchMap = {};
  const ragScatter = [];
  const schedule = Array.from({ length: 7 }, () => Array(24).fill(0));
  rows.forEach((r, idx) => {
    const source = r.source || 'unknown';
    const search = r.search_name || r.search_id || 'unknown';
    sourceMap[source] ||= { fetched: 0, notified: 0, errors: 0 };
    searchMap[search] ||= { total: 0, notified: 0, filtered: 0, byOutcome: {} };
    sourceMap[source].fetched++;
    searchMap[search].total++;
    searchMap[search].byOutcome[r.outcome || 'unknown'] = (searchMap[search].byOutcome[r.outcome || 'unknown'] || 0) + 1;
    if (r.outcome === 'new') {
      sourceMap[source].notified++;
      searchMap[search].notified++;
    }
    if ((r.outcome || '').startsWith('filtered_')) searchMap[search].filtered++;
    if (r.outcome === 'error') sourceMap[source].errors++;
    const rag = Number(r.rag_score);
    if (!Number.isNaN(rag)) ragScatter.push({ x: idx + 1, y: rag, outcome: r.outcome || 'unknown' });

    const d = getRowDate(r);
    if (d) {
      schedule[d.getUTCDay()][d.getUTCHours()]++;
    }
  });

  const sourceQuality = Object.entries(sourceMap).map(([source, v]) => ({
    source,
    fetched: v.fetched,
    notified: v.notified,
    passed: Math.max(0, v.fetched - (v.errors || 0)),
    reliability: Math.round(((v.fetched - v.errors) / Math.max(1, v.fetched)) * 1000) / 10,
    conversion: Math.round((v.notified / Math.max(1, v.fetched)) * 1000) / 10,
  })).sort((a, b) => b.fetched - a.fetched);

  const searchEffectiveness = Object.entries(searchMap).map(([search, v]) => ({
    search,
    total: v.total,
    notifyRate: Math.round((v.notified / Math.max(1, v.total)) * 1000) / 10,
    filterRate: Math.round((v.filtered / Math.max(1, v.total)) * 1000) / 10,
    byOutcome: v.byOutcome,
  })).sort((a, b) => b.total - a.total);

  const sequence = buildSequenceBuckets(rows, Math.min(12, Math.max(6, Math.ceil(rows.length / 12) || 6)));
  const seqMetrics = sequence.buckets.map(bucket => {
    const fetched = bucket.length;
    const notified = bucket.filter(r => r.outcome === 'new').length;
    const filtered = bucket.filter(r => (r.outcome || '').startsWith('filtered_')).length;
    return { fetched, notified, filtered };
  });
  const notifiedSeries = seqMetrics.map(s => s.notified);
  const mean = notifiedSeries.reduce((a, b) => a + b, 0) / Math.max(1, notifiedSeries.length);
  const variance = notifiedSeries.reduce((acc, v) => acc + ((v - mean) ** 2), 0) / Math.max(1, notifiedSeries.length);
  const stdDev = Math.sqrt(variance);
  const ucl = mean + (3 * stdDev);
  const lcl = Math.max(0, mean - (3 * stdDev));

  return {
    pareto,
    sourceQuality,
    searchEffectiveness,
    schedule,
    ragScatter,
    sequence: {
      labels: sequence.labels,
      fetched: seqMetrics.map(s => s.fetched),
      notified: seqMetrics.map(s => s.notified),
      filtered: seqMetrics.map(s => s.filtered),
      cumulativeFetched: seqMetrics.reduce((arr, s, i) => {
        arr.push((arr[i - 1] || 0) + s.fetched);
        return arr;
      }, []),
      cumulativeNotified: seqMetrics.reduce((arr, s, i) => {
        arr.push((arr[i - 1] || 0) + s.notified);
        return arr;
      }, []),
      cumulativeFiltered: seqMetrics.reduce((arr, s, i) => {
        arr.push((arr[i - 1] || 0) + s.filtered);
        return arr;
      }, []),
      control: {
        mean: Math.round(mean * 100) / 100,
        ucl: Math.round(ucl * 100) / 100,
        lcl: Math.round(lcl * 100) / 100,
      },
    },
  };
}

export function getAllJobsAggregate() {
  const rows = getAllJobsForDashboard().map(rowFromDbJob);
  return aggregate(rows);
}
