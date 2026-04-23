/**
 * Dashboard server — browse run CSVs in the browser.
 * Usage: node src/dashboard.js [--port 3099]
 */
import 'dotenv/config';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNS_DIR = path.join(__dirname, '..', 'logs', 'runs');

const portArg = process.argv.indexOf('--port');
const PORT = portArg !== -1 ? parseInt(process.argv[portArg + 1], 10) : 3099;
const HOST      = process.env.DASHBOARD_HOST      || '127.0.0.1';
const TOKEN     = process.env.DASHBOARD_TOKEN     || '';  // bearer token; required when bound to a non-loopback host
const BASE_PATH = (process.env.DASHBOARD_BASE_PATH || '').replace(/\/$/, ''); // e.g. '/job_dashboard'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '0:0:0:0:0:0:0:1']);
if (!LOOPBACK_HOSTS.has(HOST) && !TOKEN) {
  console.error(`Refusing to bind dashboard to ${HOST} without DASHBOARD_TOKEN. Set a token or keep DASHBOARD_HOST on loopback.`);
  process.exit(1);
}

// ── Bot process state ─────────────────────────────────────────────────────────
let botProc   = null;
let botStatus = { state: 'idle', mode: '', startedAt: null, exitCode: null };
const sseClients = new Set();

function pushSSE(obj) {
  const payload = `data: ${JSON.stringify(obj)}\n\n`;
  for (const r of sseClients) r.write(payload);
}

function startBot(mode) {
  if (botProc) return false;
  const isOnce = mode === 'once';
  botStatus = { state: 'running', mode, startedAt: new Date().toISOString(), exitCode: null };
  pushSSE({ type: 'status', status: botStatus });

  botProc = spawn('node', ['src/index.js'], {
    cwd:  path.join(__dirname, '..'),
    env:  { ...process.env, RUN_ONCE: isOnce ? 'true' : '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const onData = chunk => pushSSE({ type: 'log', line: chunk.toString() });
  botProc.stdout.on('data', onData);
  botProc.stderr.on('data', onData);

  botProc.on('close', code => {
    botProc = null;
    botStatus = { ...botStatus, state: code === 0 ? 'done' : 'error', exitCode: code };
    pushSSE({ type: 'status', status: botStatus });
  });
  return true;
}

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

// ── File listing ──────────────────────────────────────────────────────────────
function listCsvFiles() {
  if (!fs.existsSync(RUNS_DIR)) return [];
  return fs.readdirSync(RUNS_DIR)
    .filter(f => f.endsWith('.csv'))
    .sort()
    .reverse();
}

// Cache aggregated data per CSV, keyed by filename + mtime so stale entries are
// invalidated automatically when a run rewrites a file (and LRU-capped so long
// dashboard sessions don't grow unbounded).
const AGG_CACHE_LIMIT = 50;
const aggregateCache = new Map();
function getAggregate(filePath, filename) {
  const stat = fs.statSync(filePath);
  const cached = aggregateCache.get(filename);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    aggregateCache.delete(filename);
    aggregateCache.set(filename, cached);
    return cached.data;
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = aggregate(parseCsv(raw));
  aggregateCache.set(filename, { mtimeMs: stat.mtimeMs, data });
  if (aggregateCache.size > AGG_CACHE_LIMIT) {
    const oldest = aggregateCache.keys().next().value;
    aggregateCache.delete(oldest);
  }
  return data;
}

// ── Contract rate detection + yearly equivalent ───────────────────────────────
// Assumptions: 220 billable days/yr (252 – 8 BH – ~24 holidays), 7.5 hr/day,
// ~22.5% cost deduction (corp tax, NI, accountant, insurance) for net equivalent.
const BILLABLE_DAYS = 220;
const HOURS_PER_DAY = 7.5;
const COST_RATE     = 0.225;   // deduction for Ltd co. overhead

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

// ── Aggregate stats from parsed rows ─────────────────────────────────────────
function aggregate(rows) {
  const byOutcome = {};
  const bySource  = {};
  const bySearch  = {};
  const byRag     = {};
  const salaryVals = [];

  const contractRates = { day: [], hour: [] };

  for (const r of rows) {
    byOutcome[r.outcome] = (byOutcome[r.outcome] || 0) + 1;
    bySource[r.source]   = (bySource[r.source]   || 0) + 1;
    const label = r.search_name || r.search_id || 'unknown';
    bySearch[label]      = (bySearch[label]      || 0) + 1;
    if (r.rag_rating)    byRag[r.rag_rating]     = (byRag[r.rag_rating] || 0) + 1;
    if (r.salary_min && Number(r.salary_min) > 0) salaryVals.push(Number(r.salary_min));

    // enrich row with rate info
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
  for (const r of rows) {
    const n = Number(r.salary_min);
    r.salaryBucket = (n && n > 0) ? bucketOf(n) : '';
  }

  return {
    total:       rows.length,
    notified:    rows.filter(r => r.outcome === 'new').length,
    alreadySeen: rows.filter(r => r.outcome === 'already_seen').length,
    filtered:    rows.filter(r => r.outcome?.startsWith('filtered')).length,
    salaryCount: salaryVals.length,
    runAt:       rows[0]?.run_at  ?? '',
    trigger:     rows[0]?.trigger ?? '',
    byOutcome, bySource, bySearch, byRag, salaryBuckets,
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

// ── HTML ──────────────────────────────────────────────────────────────────────
const HTML = /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Job Alert Bot — Run Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js"></script>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#0f1117;color:#e2e8f0;min-height:100vh;overflow-x:hidden}
header{background:#1a1d27;padding:.8rem 1.25rem;display:flex;align-items:center;gap:.75rem;border-bottom:1px solid #2d3148;position:sticky;top:0;z-index:100;flex-wrap:wrap}
header h1{font-size:1rem;font-weight:600;color:#a5b4fc;flex:1;min-width:220px}
select{background:#252836;color:#e2e8f0;border:1px solid #3d4268;border-radius:6px;padding:.35rem .7rem;font-size:.85rem;cursor:pointer;max-width:min(100%,420px);min-width:210px}
select:focus{outline:2px solid #6366f1}
#meta{font-size:.78rem;color:#64748b;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
main{padding:1rem 1.25rem 1.5rem;display:grid;gap:.85rem}

/* ── Cross-filter bar ── */
.filter-bar{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;background:#161a29;border:1px solid #222741;border-radius:8px;padding:.45rem .65rem;position:sticky;top:52px;z-index:90;box-shadow:0 2px 8px rgba(0,0,0,.35)}
.filter-bar.empty{display:none}
.filter-bar-label{font-size:.72rem;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;font-weight:600}
.filter-chip{display:inline-flex;align-items:center;gap:.35rem;background:#1e2235;border:1px solid #3d4268;color:#c7d2fe;border-radius:999px;padding:.2rem .55rem .2rem .7rem;font-size:.75rem;cursor:pointer;transition:background .15s}
.filter-chip:hover{background:#2f3552}
.filter-chip b{font-weight:600;color:#a5b4fc}
.filter-chip .x{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:50%;background:#3d4268;color:#fff;font-size:.65rem;line-height:1}
.filter-chip:hover .x{background:#6366f1}
.filter-clear-all{margin-left:auto;background:transparent;border:none;color:#94a3b8;font-size:.75rem;cursor:pointer;text-decoration:underline}
.filter-clear-all:hover{color:#f87171}

/* ── Collapsible sections ── */
.section{background:#14171f;border:1px solid #222741;border-radius:10px;overflow:hidden}
.section-header{display:flex;align-items:center;gap:.6rem;padding:.65rem .9rem;background:#181b25;border-bottom:1px solid #222741;cursor:pointer;user-select:none}
.section.open .section-header{border-bottom-color:#2d3148}
.section:not(.open) .section-header{border-bottom:none}
.section-header:hover{background:#1c2030}
.section-header .chev{display:inline-block;transition:transform .2s;color:#a5b4fc;font-size:.75rem;width:14px}
.section.open .section-header .chev{transform:rotate(90deg)}
.section-header h2{font-size:.82rem;font-weight:600;color:#e2e8f0;letter-spacing:.02em;text-transform:none;margin:0}
.section-header .section-meta{font-size:.72rem;color:#64748b;margin-left:auto}
.section-header .section-pin{display:inline-flex;align-items:center;gap:.25rem;font-size:.68rem;color:#64748b;background:#0f1220;border:1px solid #222741;padding:.1rem .4rem;border-radius:4px}
.section-body{padding:.9rem;display:none}
.section.open .section-body{display:block}
.section-body>.charts-grid{gap:.85rem}

.kpi-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:.75rem}
.kpi{background:#1a1d27;border:1px solid #2d3148;border-radius:10px;padding:.9rem 1.1rem}
.kpi .val{font-size:1.9rem;font-weight:700;line-height:1}
.kpi .lbl{font-size:.72rem;color:#94a3b8;margin-top:.3rem;text-transform:uppercase;letter-spacing:.05em}
.kpi.green  .val{color:#4ade80}
.kpi.amber  .val{color:#fbbf24}
.kpi.red    .val{color:#f87171}
.kpi.blue   .val{color:#60a5fa}
.kpi.purple .val{color:#a78bfa}
.charts-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:1.25rem}
.card{background:#1a1d27;border:1px solid #2d3148;border-radius:10px;padding:1.1rem}
.card,.kpi,.table-card{min-width:0}
.card h2{font-size:.78rem;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin-bottom:.9rem;display:flex;align-items:center;gap:.45rem}
.help-tip{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;border:1px solid #3d4268;background:#252836;color:#a5b4fc;font-size:.68rem;cursor:help;line-height:1}
.help-tip:focus{outline:2px solid #6366f1}
.help-tip:hover,.help-tip:focus{background:#2f3552;color:#c7d2fe}
.scope-badge{display:inline-flex;align-items:center;padding:.2rem .5rem;border-radius:999px;background:#1e2235;border:1px solid #2d3148;color:#93c5fd;font-size:.7rem;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chart-wrap{position:relative;height:180px}
.chart-wrap.tall{height:230px}
.chart-wrap.xtall{height:280px}
.card.filter-active{box-shadow:0 0 0 1px #6366f1 inset}
.card canvas{cursor:pointer}
.kpi{cursor:pointer;transition:border-color .15s}
.kpi:hover{border-color:#6366f1}
.kpi.filter-active{border-color:#6366f1;box-shadow:0 0 0 1px #6366f1 inset}
.kpi.static{cursor:default}
.kpi.static:hover{border-color:#2d3148}
.help-glossary{background:#1a1d27;border:1px solid #2d3148;border-radius:10px;padding:1.1rem}
.help-glossary h2{font-size:.78rem;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin-bottom:.7rem}
.help-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:.75rem}
.help-item{font-size:.8rem;color:#cbd5e1;background:#161a29;border:1px solid #222741;border-radius:8px;padding:.6rem .7rem}
.help-item strong{display:block;color:#a5b4fc;font-size:.74rem;text-transform:uppercase;letter-spacing:.04em;margin-bottom:.25rem}
.diagram-card{background:#1a1d27;border:1px solid #2d3148;border-radius:10px;padding:1.1rem}
.diagram-header{display:flex;align-items:center;justify-content:space-between;gap:.6rem;flex-wrap:wrap;margin-bottom:.7rem}
.diagram-title{font-size:.78rem;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em}
.diagram-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:.85rem}
.diagram-box{background:#161a29;border:1px solid #222741;border-radius:8px;padding:.75rem}
.diagram-flow{display:grid;gap:.6rem}
.flow-step{display:flex;align-items:center;justify-content:space-between;gap:.45rem;padding:.45rem .55rem;border-radius:6px;background:#1e2235;color:#cbd5e1;font-size:.8rem}
.flow-step::after{content:'→';color:#6366f1;font-weight:700}
.flow-step:last-child::after{content:''}
.schema-row{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:.4rem;font-size:.79rem;color:#cbd5e1}
.schema-node{background:#1e2235;border:1px solid #2d3148;border-radius:6px;padding:.45rem .5rem}
.schema-join{color:#818cf8;font-weight:700}

/* ── Table section ── */
.table-card{background:#1a1d27;border:1px solid #2d3148;border-radius:10px;padding:1.1rem}
.table-toolbar{display:flex;align-items:center;gap:.75rem;margin-bottom:.9rem;flex-wrap:wrap}
.table-toolbar h2{font-size:.78rem;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;flex:1;min-width:120px}
#globalSearch{background:#252836;color:#e2e8f0;border:1px solid #3d4268;border-radius:6px;padding:.35rem .7rem;font-size:.83rem;width:220px}
#globalSearch:focus{outline:2px solid #6366f1}
#rowCount{font-size:.78rem;color:#64748b;white-space:nowrap}
.btn{background:#252836;color:#94a3b8;border:1px solid #3d4268;border-radius:6px;padding:.3rem .65rem;font-size:.8rem;cursor:pointer;transition:background .15s}
.btn:hover{background:#2d3148;color:#e2e8f0}
.btn.active{background:#6366f1;color:#fff;border-color:#6366f1}
.table-wrap{overflow:auto;border-radius:6px;border:1px solid #2d3148;max-height:60vh}
table{width:100%;border-collapse:collapse;font-size:.8rem;min-width:900px}
thead tr.header-row th{background:#1e2235;color:#94a3b8;font-weight:600;text-transform:uppercase;font-size:.72rem;letter-spacing:.05em;padding:.55rem .7rem;white-space:nowrap;border-bottom:1px solid #2d3148;position:sticky;top:0;z-index:10;user-select:none}
thead tr.header-row th.sortable{cursor:pointer}
thead tr.header-row th.sortable:hover{color:#e2e8f0;background:#252836}
thead tr.header-row th .sort-icon{display:inline-block;margin-left:.3rem;opacity:.35;font-style:normal}
thead tr.header-row th.asc  .sort-icon::after{content:'▲';opacity:1}
thead tr.header-row th.desc .sort-icon::after{content:'▼';opacity:1}
thead tr.header-row th:not(.asc):not(.desc) .sort-icon::after{content:'⇅'}
thead tr.filter-row th{background:#191c2a;padding:.3rem .4rem;border-bottom:2px solid #2d3148}
thead tr.filter-row input,
thead tr.filter-row select{width:100%;background:#252836;color:#e2e8f0;border:1px solid #2d3148;border-radius:4px;padding:.25rem .4rem;font-size:.75rem}
thead tr.filter-row input:focus,
thead tr.filter-row select:focus{outline:1px solid #6366f1;border-color:#6366f1}
tbody tr{border-bottom:1px solid #1e2235;transition:background .1s}
tbody tr:hover{background:#1e2235}
tbody td{padding:.45rem .7rem;vertical-align:top;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
tbody td.wrap{white-space:normal;word-break:break-word}
tbody td a{color:#60a5fa;text-decoration:none}
tbody td a:hover{text-decoration:underline}
.badge{display:inline-block;padding:.15rem .45rem;border-radius:4px;font-size:.7rem;font-weight:600;white-space:nowrap}
.badge.new              {background:#14532d;color:#4ade80}
.badge.already_seen     {background:#1e3a5f;color:#60a5fa}
.badge.filtered_seniority{background:#3b1111;color:#f87171}
.badge.filtered_salary  {background:#3b2e08;color:#fbbf24}
.badge.filtered_match   {background:#3b1f08;color:#fb923c}
.badge.filtered_rag     {background:#2e0f3b;color:#e879f9}
.badge.rate-day {background:#0c2a3b;color:#38bdf8}
.badge.rate-hour{background:#1a1040;color:#a78bfa}
.badge.Green{background:#14532d;color:#4ade80}
.badge.Amber{background:#3b2e08;color:#fbbf24}
.badge.Red  {background:#3b1111;color:#f87171}
.badge.contract{background:#1e3a5f;color:#38bdf8}
.badge.perm    {background:#1e2235;color:#64748b}
.top-scroll-wrap{overflow-x:auto;overflow-y:hidden;height:12px;margin-bottom:2px}
.top-scroll-inner{height:1px}
.bottom-scroll-wrap{overflow-x:auto;overflow-y:hidden;height:14px;position:sticky;bottom:0;background:#1a1d27;border-top:1px solid #2d3148;z-index:20}
.bottom-scroll-inner{height:1px}
.cr-note{font-size:.72rem;color:#475569;margin-bottom:.5rem;font-style:italic}
.cr-row{display:flex;align-items:center;gap:.75rem;padding:.55rem 0;border-bottom:1px solid #1e2235;flex-wrap:wrap}
.cr-row:last-child{border-bottom:none}
.cr-count {font-size:.82rem;color:#94a3b8}
.cr-range {font-size:.82rem;color:#e2e8f0;font-weight:500}
.cr-yearly{font-size:.8rem;color:#94a3b8;margin-left:auto}
.yearly-gross{color:#94a3b8;font-size:.8rem}
.yearly-net  {color:#4ade80;font-size:.8rem;font-weight:600}
#loading{text-align:center;padding:4rem;color:#64748b;font-size:1.1rem}
#error  {text-align:center;padding:4rem;color:#f87171}
/* ── Bot controls ── */
.run-btn{background:#6366f1;color:#fff;border:none;border-radius:6px;padding:.35rem .85rem;font-size:.83rem;font-weight:600;cursor:pointer;transition:background .15s,opacity .15s;white-space:nowrap}
.run-btn:hover:not(:disabled){background:#4f46e5}
.run-btn:disabled{opacity:.5;cursor:default}
.run-btn.stop{background:#dc2626}
.run-btn.stop:hover:not(:disabled){background:#b91c1c}
#headerButtons{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
#botStateBadge{font-size:.75rem;padding:.2rem .55rem;border-radius:4px;font-weight:600;white-space:nowrap}
#botStateBadge.idle   {background:#1e2235;color:#64748b}
#botStateBadge.running{background:#0c2a3b;color:#38bdf8;animation:pulse 1.4s ease-in-out infinite}
#botStateBadge.done   {background:#14532d;color:#4ade80}
#botStateBadge.error  {background:#3b1111;color:#f87171}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.55}}
#logPanel{background:#0b0d12;border-bottom:1px solid #2d3148;padding:.6rem 1.25rem;font-family:monospace;font-size:.73rem;color:#94a3b8;max-height:200px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;display:none}
@media (max-width: 1100px){
  header{padding:.7rem 1rem}
  header h1{flex-basis:100%;min-width:0}
  #meta{order:4;flex:1 1 100%;white-space:normal;overflow:visible;text-overflow:clip}
}
@media (max-width: 860px){
  main{padding:1rem;gap:1rem}
  .charts-grid{grid-template-columns:1fr}
  .chart-wrap{height:230px}
  .chart-wrap.tall{height:260px}
  .chart-wrap.xtall{height:280px}
  .table-toolbar h2{flex-basis:100%}
  #globalSearch{width:100%;max-width:none}
}
@media (max-width: 640px){
  header{gap:.55rem}
  select{min-width:0;flex:1 1 100%}
  #headerButtons{flex:1 1 100%}
  #headerButtons .run-btn{flex:1 1 calc(50% - .5rem);text-align:center}
  .kpi-row{grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:.75rem}
  .kpi .val{font-size:1.55rem}
  .table-wrap{max-width:100%}
  .help-grid,.diagram-grid{grid-template-columns:1fr}
}
</style>
</head>
<body>
<header>
  <h1>Job Alert Bot — Run Dashboard</h1>
  <select id="fileSelect"></select>
  <span id="meta"></span>
  <span id="botStateBadge" class="idle">idle</span>
  <div id="headerButtons">
    <button id="runOnceBtn" class="run-btn" title="Run one fetch cycle now">▶ Run Once</button>
    <button id="startBotBtn" class="run-btn" title="Start the bot scheduler (npm start)">▶ Start Bot</button>
    <button id="stopBotBtn"  class="run-btn stop" title="Stop the running process" style="display:none">■ Stop</button>
  </div>
</header>
<div id="logPanel"></div>
<section id="trendSection" style="padding:1.25rem 1.25rem 0;display:none">
  <div class="card">
    <h2 style="font-size:.78rem;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin-bottom:.9rem;display:flex;align-items:center;gap:.45rem">
      Notify rate — recent runs
      <span class="help-tip" data-help="What: Notify rate (% of fetched rows that got through all filters) across the most recent runs, with a trailing 7-run mean baseline. Why: Tell today's run from the baseline at a glance. Read: Flat or rising is healthy; a dip below the baseline means source or filter drift.">?</span>
    </h2>
    <div class="chart-wrap tall"><canvas id="cTrend"></canvas></div>
  </div>
</section>
<main id="main">
  <div id="loading">Loading…</div>
</main>

<script>
const API_BASE = '${BASE_PATH}';
// ── Constants ─────────────────────────────────────────────────────────────────
const OUTCOME_COLORS = {
  new:                '#4ade80',
  already_seen:       '#60a5fa',
  filtered_seniority: '#f87171',
  filtered_salary:    '#fbbf24',
  filtered_match:     '#fb923c',
  filtered_rag:       '#e879f9',
};
const RAG_COLORS = { Green: '#4ade80', Amber: '#fbbf24', Red: '#f87171' };
const PALETTE = ['#6366f1','#22d3ee','#f59e0b','#10b981','#ec4899','#a78bfa','#fb923c','#38bdf8','#84cc16','#e11d48'];
const DOW_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const HELP_TEXT = {
  outcome: 'What: Distribution of row outcomes in this selected CSV. Why: Quickly see signal vs noise. Read: More notified with fewer filtered outcomes is better.',
  rag: 'What: Green/Amber/Red split for rated rows. Why: Shows relevance quality mix. Read: More Green usually means higher-fit alerts.',
  source: 'What: Total rows by source in the selected CSV. Why: Detect source dominance. Read: Very skewed sources may mask other opportunities.',
  search: 'What: Rows by configured search. Why: Compare query yield. Read: High volume with low notify suggests noisy search terms.',
  salary: 'What: Salary band distribution. Why: Validate pay target alignment. Read: Bands should match your preferred market range.',
  sourceQuality: 'What: Source-level fetched, passed and notified counts. Why: Measure source quality, not only volume. Read: Strong sources have higher notified/fetched ratios.',
  outcomesOverTime: 'What: Outcome mix over sequence slices inside this selected CSV. Why: Spot deterioration during a run. Read: Rising filtered slices can suggest source/query drift.',
  pareto: 'What: Filter reasons sorted by impact with cumulative %. Why: Identify biggest blockers quickly. Read: Target the top one or two causes first.',
  searchHeatmap: 'What: Search by outcome-rate heatmap bubbles. Why: Compare effectiveness per search. Read: Brighter notified cells indicate higher signal queries.',
  reliability: 'What: Per-source success ratio in this selected CSV. Why: Catch weak sources in-run. Read: Lower ratios imply errors or poor quality output.',
  control: 'What: Notified counts with mean and control limits per sequence slice. Why: Detect abnormal variation. Read: Points outside limits are potential anomalies.',
  throughput: 'What: Cumulative fetched/notified/filtered over sequence slices. Why: Understand throughput shape within this CSV. Read: Healthy runs usually increase notified steadily.',
  schedule: 'What: Day-hour activity heatmap from row timestamps. Why: Understand when captured jobs cluster. Read: Hot cells show active posting windows.',
  scatter: 'What: RAG score scatter by row order and outcome color. Why: Validate scoring vs decision outcomes. Read: Useful signals cluster at higher scores.',
  pipeline: 'What: High-level ingest pipeline for selected CSV rows. Why: Explain where each metric comes from. Read: Each stage transforms or filters rows.',
  schema: 'What: CSV row schema and derived metric grouping. Why: Clarify data lineage for charts. Read: Derived views are computed only from current file.',
};

// ── Table columns definition ──────────────────────────────────────────────────
const COLS = [
  { key: 'url',         label: 'Link',        type: 'text',   width: '60px',  isLink: true },
  { key: 'title',       label: 'Title',       type: 'text',   width: '220px' },
  { key: 'company',     label: 'Company',     type: 'text',   width: '140px' },
  { key: 'location',    label: 'Location',    type: 'text',   width: '130px' },
  { key: 'source',      label: 'Source',      type: 'select', width: '100px' },
  { key: 'search_name', label: 'Search',      type: 'select', width: '150px' },
  { key: 'salary_text', label: 'Salary',      type: 'text',   width: '130px' },
  { key: 'is_contract', label: 'Contract',    type: 'select', width: '85px'  },
  { key: 'rateType',    label: 'Rate type',  type: 'select', width: '85px'  },
  { key: 'rateDisplay', label: 'Rate',       type: 'text',   width: '130px', isRate: true },
  { key: 'yearlyGross', label: '~Gross/yr',  type: 'text',   width: '130px', isYearly: 'gross' },
  { key: 'yearlyNet',   label: '~Net equiv', type: 'text',   width: '130px', isYearly: 'net'   },
  { key: 'remote_type',            label: 'Remote',        type: 'select', width: '85px'  },
  { key: 'sectors',                label: 'Sectors',       type: 'text',   width: '130px' },
  { key: 'clearances',             label: 'Clearance',     type: 'select', width: '90px'  },
  { key: 'tech_tools',             label: 'Tools',         type: 'text',   width: '180px', wrap: true },
  { key: 'years_experience',       label: 'Years',         type: 'text',   width: '55px'  },
  { key: 'contract_length_months', label: 'Length (mo)',   type: 'text',   width: '80px'  },
  { key: 'bonus_percent',          label: 'Bonus %',       type: 'text',   width: '75px'  },
  { key: 'car_allowance',          label: 'Car',           type: 'text',   width: '80px'  },
  { key: 'pension_percent',        label: 'Pension %',     type: 'text',   width: '80px'  },
  { key: 'has_equity',             label: 'Equity',        type: 'select', width: '70px'  },
  { key: 'outcome',     label: 'Outcome',     type: 'select', width: '130px' },
  { key: 'rag_rating',  label: 'RAG',         type: 'select', width: '70px'  },
  { key: 'rag_score',   label: 'Score',       type: 'text',   width: '60px'  },
  { key: 'rag_reason',  label: 'Reason',      type: 'text',   width: '200px', wrap: true },
  { key: 'posted_at',   label: 'Posted',      type: 'text',   width: '110px' },
];

// ── Chart helpers ─────────────────────────────────────────────────────────────
let charts = [];
function destroyCharts() { charts.forEach(c => c.destroy()); charts = []; }

function mkChart(id, type, labels, datasets, extra = {}) {
  const ctx = document.getElementById(id);
  if (!ctx) return;
  const { onPick, ...rest } = extra;
  charts.push(new Chart(ctx, {
    type,
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#94a3b8', boxWidth: 12, font: { size: 11 } } } },
      scales: (type === 'bar') ? {
        x: { ticks: { color: '#94a3b8', font: { size: 11 } }, grid: { color: '#1e2235' } },
        y: { ticks: { color: '#94a3b8', font: { size: 11 } }, grid: { color: '#1e2235' } },
      } : {},
      onClick: onPick ? (evt, active, chart) => {
        if (!active || !active.length) return;
        const el = active[0];
        const label = chart.data.labels?.[el.index];
        const dataset = chart.data.datasets?.[el.datasetIndex];
        const raw = dataset?.data?.[el.index];
        onPick({ label, datasetLabel: dataset?.label, raw, index: el.index, datasetIndex: el.datasetIndex, chart });
      } : undefined,
      ...rest,
    },
  }));
}

function colorFromPercent(pct) {
  const alpha = Math.max(0.15, Math.min(0.95, pct / 100));
  return 'rgba(99,102,241,' + alpha + ')';
}

function cardTitle(text, helpKey) {
  const tip = HELP_TEXT[helpKey] || '';
  return '<h2>' + escHtml(text) + '<button class="help-tip" type="button" aria-label="Help" data-help="' + escHtml(tip) + '">?</button></h2>';
}

function renderHelpGlossary() {
  const rows = [
    ['Filtered Match', 'Row filtered because description/title did not match search intent strongly enough.'],
    ['Filtered Seniority', 'Row removed because seniority signal did not match target level filters.'],
    ['RAG Score', 'Numeric relevance score used alongside Green/Amber/Red rating for triage.'],
    ['Control Limits', 'Statistical upper/lower bounds for normal notified variation within selected CSV slices.'],
    ['Source Reliability', 'Share of rows from a source that are not errors inside this selected CSV.'],
  ];
  return '<div class="help-glossary"><h2>Dashboard glossary</h2><div class="help-grid">' +
    rows.map(([k, v]) => '<div class="help-item"><strong>' + escHtml(k) + '</strong>' + escHtml(v) + '</div>').join('') +
  '</div></div>';
}

function initHelpTips() {
  let tooltip = document.getElementById('helpTooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'helpTooltip';
    tooltip.style.position = 'fixed';
    tooltip.style.zIndex = '9999';
    tooltip.style.maxWidth = '320px';
    tooltip.style.padding = '.55rem .65rem';
    tooltip.style.background = '#0f172a';
    tooltip.style.border = '1px solid #334155';
    tooltip.style.borderRadius = '8px';
    tooltip.style.color = '#cbd5e1';
    tooltip.style.fontSize = '.75rem';
    tooltip.style.lineHeight = '1.4';
    tooltip.style.display = 'none';
    document.body.appendChild(tooltip);
  }
  const show = (el) => {
    const tip = el.getAttribute('data-help');
    if (!tip) return;
    tooltip.textContent = tip;
    const rect = el.getBoundingClientRect();
    tooltip.style.left = Math.min(window.innerWidth - 340, rect.left + 20) + 'px';
    tooltip.style.top = Math.max(8, rect.bottom + 8) + 'px';
    tooltip.style.display = 'block';
  };
  const hide = () => { tooltip.style.display = 'none'; };
  document.querySelectorAll('.help-tip').forEach(btn => {
    btn.addEventListener('mouseenter', () => show(btn));
    btn.addEventListener('focus', () => show(btn));
    btn.addEventListener('mouseleave', hide);
    btn.addEventListener('blur', hide);
    btn.addEventListener('click', () => {
      if (tooltip.style.display === 'block') hide();
      else show(btn);
    });
  });
}

// ── Cross-filter state (PowerBI-style chart → table) ─────────────────────────
const CROSS_FILTER_LABELS = {
  outcome: 'Outcome',
  rag_rating: 'RAG',
  source: 'Source',
  search_name: 'Search',
  salaryBucket: 'Salary band',
  rateType: 'Rate type',
  is_contract: 'Contract',
};
let crossFilters = {}; // { key: Set<string> }

function toggleCrossFilter(key, value) {
  if (value == null || value === '') return;
  const set = crossFilters[key] || new Set();
  if (set.has(value)) set.delete(value); else set.add(value);
  if (set.size) crossFilters[key] = set; else delete crossFilters[key];
  syncCrossFilterUI();
}

function clearCrossFilters() {
  crossFilters = {};
  syncCrossFilterUI();
}

function hasCrossFilters() {
  return Object.keys(crossFilters).length > 0;
}

function syncCrossFilterUI() {
  renderFilterBar();
  renderTable();
  updateKpisFromVisible();
  markActiveCards();
}

function renderFilterBar() {
  const bar = document.getElementById('filterBar');
  if (!bar) return;
  const entries = Object.entries(crossFilters);
  if (!entries.length) { bar.className = 'filter-bar empty'; bar.innerHTML = ''; return; }
  bar.className = 'filter-bar';
  const chips = entries.flatMap(([key, set]) =>
    [...set].map(v => {
      return '<span class="filter-chip" data-key="' + escHtml(key) + '" data-val="' + escHtml(v) + '" title="Remove this filter">'
        + '<b>' + escHtml(CROSS_FILTER_LABELS[key] || key) + ':</b> ' + escHtml(v)
        + '<span class="x">×</span></span>';
    })
  ).join('');
  bar.innerHTML = '<span class="filter-bar-label">Active filters</span>' + chips
    + '<button class="filter-clear-all" id="filterClearAll">Clear all</button>';
  bar.querySelectorAll('.filter-chip').forEach(el => {
    el.addEventListener('click', () => toggleCrossFilter(el.dataset.key, el.dataset.val));
  });
  const clearBtn = bar.querySelector('#filterClearAll');
  if (clearBtn) clearBtn.addEventListener('click', clearCrossFilters);
}

function markActiveCards() {
  document.querySelectorAll('.card[data-filter-key]').forEach(card => {
    const k = card.dataset.filterKey;
    card.classList.toggle('filter-active', !!crossFilters[k]);
  });
  document.querySelectorAll('.kpi[data-kpi-outcome]').forEach(el => {
    const v = el.dataset.kpiOutcome;
    const on = crossFilters.outcome && crossFilters.outcome.has(v);
    el.classList.toggle('filter-active', !!on);
  });
  const kpiFiltered = document.querySelector('.kpi[data-kpi="filtered"]');
  if (kpiFiltered) {
    const s = crossFilters.outcome;
    const on = !!s && s.size > 0 && [...s].every(v => v.startsWith('filtered'));
    kpiFiltered.classList.toggle('filter-active', on);
  }
}

function rowsPassingCross(rows) {
  if (!hasCrossFilters()) return rows;
  return rows.filter(r => {
    for (const [k, set] of Object.entries(crossFilters)) {
      const rv = r[k] || '';
      if (!set.has(rv)) return false;
    }
    return true;
  });
}

function updateKpisFromVisible() {
  const rows = rowsPassingCross(tableRows);
  const $ = id => document.getElementById(id);
  const total    = rows.length;
  const notified = rows.filter(r => r.outcome === 'new').length;
  const seen     = rows.filter(r => r.outcome === 'already_seen').length;
  const filtered = rows.filter(r => (r.outcome || '').startsWith('filtered')).length;
  const salCount = rows.filter(r => Number(r.salary_min) > 0).length;
  if ($('kpiTotal'))    $('kpiTotal').textContent    = total;
  if ($('kpiNotified')) $('kpiNotified').textContent = notified;
  if ($('kpiSeen'))     $('kpiSeen').textContent     = seen;
  if ($('kpiFiltered')) $('kpiFiltered').textContent = filtered;
  if ($('kpiSalary'))   $('kpiSalary').textContent   = salCount;
}

// ── Collapsible section persistence ──────────────────────────────────────────
const SECTION_STORAGE_KEY = 'dashSectionsOpen';
function loadSectionState() {
  try { return JSON.parse(localStorage.getItem(SECTION_STORAGE_KEY) || '{}'); } catch { return {}; }
}
function saveSectionState(state) {
  try { localStorage.setItem(SECTION_STORAGE_KEY, JSON.stringify(state)); } catch {}
}
function initSectionToggles() {
  const state = loadSectionState();
  document.querySelectorAll('.section').forEach(section => {
    const id = section.dataset.section;
    if (id && id in state) section.classList.toggle('open', !!state[id]);
    const header = section.querySelector('.section-header');
    if (!header) return;
    header.addEventListener('click', () => {
      section.classList.toggle('open');
      const s = loadSectionState();
      s[id] = section.classList.contains('open');
      saveSectionState(s);
    });
  });
}

// ── Table state ───────────────────────────────────────────────────────────────
let tableRows  = [];
let sortCol    = null;
let sortDir    = 'asc';   // 'asc' | 'desc'
let colFilters = {};      // { colKey: string }
let globalQ    = '';

function getVisible() {
  let rows = rowsPassingCross(tableRows);

  // global search
  if (globalQ) {
    const q = globalQ.toLowerCase();
    rows = rows.filter(r => COLS.some(c => (r[c.key] || '').toLowerCase().includes(q)));
  }

  // per-column filters
  for (const [k, v] of Object.entries(colFilters)) {
    if (!v) continue;
    const vl = v.toLowerCase();
    rows = rows.filter(r => (r[k] || '').toLowerCase().includes(vl));
  }

  // sort
  if (sortCol) {
    rows = [...rows].sort((a, b) => {
      const av = (a[sortCol] || '').toLowerCase();
      const bv = (b[sortCol] || '').toLowerCase();
      const na = Number(a[sortCol]);
      const nb = Number(b[sortCol]);
      const cmp = (!isNaN(na) && !isNaN(nb)) ? na - nb : av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }

  return rows;
}

function renderTable() {
  const visible = getVisible();

  document.getElementById('rowCount').textContent =
    visible.length === tableRows.length
      ? tableRows.length + ' rows'
      : visible.length + ' / ' + tableRows.length + ' rows';

  // body
  const tbody = document.getElementById('tBody');
  tbody.innerHTML = visible.map(r => '<tr>' + COLS.map(c => {
    const v = r[c.key] ?? '';
    let cell;
    if (c.isLink && v) {
      cell = '<a href="' + escHtml(v) + '" target="_blank" rel="noreferrer">open ↗</a>';
    } else if (c.isRate && v) {
      const cls = r.rateType === 'day' ? 'rate-day' : 'rate-hour';
      cell = '<span class="badge ' + cls + '">' + escHtml(v) + '</span>';
    } else if (c.isYearly && v) {
      const cls = c.isYearly === 'net' ? 'yearly-net' : 'yearly-gross';
      cell = '<span class="' + cls + '">' + escHtml(v) + '</span>';
    } else if (c.key === 'outcome' && v) {
      cell = '<span class="badge ' + escHtml(v) + '">' + escHtml(v) + '</span>';
    } else if (c.key === 'rag_rating' && v) {
      cell = '<span class="badge ' + escHtml(v) + '">' + escHtml(v) + '</span>';
    } else if (c.key === 'is_contract') {
      cell = v === 'yes'
        ? '<span class="badge contract">Contract</span>'
        : '<span class="badge perm">Perm</span>';
    } else {
      cell = escHtml(v);
    }
    return '<td' + (c.wrap ? ' class="wrap"' : '') + ' title="' + escHtml(v) + '">' + cell + '</td>';
  }).join('') + '</tr>').join('');

  // sync scrollbar widths
  const tableWrap    = document.getElementById('tableWrap');
  const topInner     = document.getElementById('topScrollInner');
  const bottomInner  = document.getElementById('bottomScrollInner');
  if (tableWrap) {
    const w = tableWrap.scrollWidth + 'px';
    if (topInner)    topInner.style.width    = w;
    if (bottomInner) bottomInner.style.width = w;
  }
}

function buildTableHTML(rows) {
  // unique values for select filters
  const opts = {};
  COLS.filter(c => c.type === 'select').forEach(c => {
    opts[c.key] = [...new Set(rows.map(r => r[c.key] || '').filter(Boolean))].sort();
  });

  const headerCells = COLS.map(c =>
    '<th class="sortable" data-key="' + c.key + '" style="min-width:' + (c.width||'auto') + '">' +
    c.label + '<i class="sort-icon"></i></th>'
  ).join('');

  const filterCells = COLS.map(c => {
    if (c.type === 'select') {
      const options = ['<option value="">All</option>']
        .concat(opts[c.key].map(v => '<option value="' + escHtml(v) + '">' + escHtml(v) + '</option>'))
        .join('');
      return '<th><select data-filter="' + c.key + '">' + options + '</select></th>';
    }
    return '<th><input type="text" placeholder="filter…" data-filter="' + c.key + '"/></th>';
  }).join('');

  return \`
<div class="table-card">
  <div class="table-toolbar">
    <h2>Raw data</h2>
    <input id="globalSearch" type="text" placeholder="Search all columns…"/>
    <span id="rowCount"></span>
    <button class="btn" id="clearFilters">Clear filters</button>
  </div>
  <div class="top-scroll-wrap" id="topScroll"><div class="top-scroll-inner" id="topScrollInner"></div></div>
  <div class="table-wrap" id="tableWrap">
    <table>
      <thead>
        <tr class="header-row">\${headerCells}</tr>
        <tr class="filter-row">\${filterCells}</tr>
      </thead>
      <tbody id="tBody"></tbody>
    </table>
  </div>
  <div class="bottom-scroll-wrap" id="bottomScroll"><div class="bottom-scroll-inner" id="bottomScrollInner"></div></div>
</div>\`;
}

function initTableEvents() {
  // sort
  document.querySelectorAll('thead tr.header-row th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      if (sortCol === key) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortCol = key; sortDir = 'asc';
      }
      document.querySelectorAll('thead tr.header-row th').forEach(h => h.classList.remove('asc','desc'));
      th.classList.add(sortDir);
      page = 1;
      renderTable();
    });
  });

  // per-column filters
  document.querySelectorAll('[data-filter]').forEach(el => {
    el.addEventListener('input', () => {
      colFilters[el.dataset.filter] = el.value;
      page = 1;
      renderTable();
    });
  });

  // global search
  document.getElementById('globalSearch').addEventListener('input', e => {
    globalQ = e.target.value;
    page = 1;
    renderTable();
  });

  // clear
  document.getElementById('clearFilters').addEventListener('click', () => {
    globalQ = ''; sortCol = null; colFilters = {};
    document.getElementById('globalSearch').value = '';
    document.querySelectorAll('[data-filter]').forEach(el => { el.value = ''; });
    document.querySelectorAll('thead tr.header-row th').forEach(h => h.classList.remove('asc','desc'));
    renderTable();
  });

  // sync top ↔ table ↔ bottom scrollbars
  const topScroll    = document.getElementById('topScroll');
  const tableWrap    = document.getElementById('tableWrap');
  const bottomScroll = document.getElementById('bottomScroll');
  let syncing = false;
  function syncFrom(source) {
    if (syncing) return;
    syncing = true;
    const x = source.scrollLeft;
    if (topScroll    !== source) topScroll.scrollLeft    = x;
    if (tableWrap    !== source) tableWrap.scrollLeft    = x;
    if (bottomScroll !== source) bottomScroll.scrollLeft = x;
    syncing = false;
  }
  topScroll.addEventListener('scroll',    () => syncFrom(topScroll));
  tableWrap.addEventListener('scroll',    () => syncFrom(tableWrap));
  bottomScroll.addEventListener('scroll', () => syncFrom(bottomScroll));
}

// ── Render full page ──────────────────────────────────────────────────────────
function render(data) {
  destroyCharts();
  tableRows = data.rows || [];
  sortCol = null; sortDir = 'asc'; colFilters = {}; globalQ = ''; page = 1;
  crossFilters = {};
  const analytics = data.analytics || {};
  const sequence = analytics.sequence || { labels: [], fetched: [], notified: [], filtered: [], cumulativeFetched: [], cumulativeNotified: [], cumulativeFiltered: [], control: { mean: 0, ucl: 0, lcl: 0 } };
  const selectedFile = document.getElementById('fileSelect')?.value || 'selected csv';

  const main = document.getElementById('main');
  main.innerHTML = \`
    <div class="kpi-row">
      <div class="kpi blue static">                                                                       <div class="val" id="kpiTotal">\${data.total}</div>         <div class="lbl">Total fetched</div></div>
      <div class="kpi green"  data-kpi-outcome="new"          title="Click to filter table by Notified">     <div class="val" id="kpiNotified">\${data.notified}</div>   <div class="lbl">Notified</div></div>
      <div class="kpi amber"  data-kpi-outcome="already_seen" title="Click to filter table by Already seen"> <div class="val" id="kpiSeen">\${data.alreadySeen}</div>    <div class="lbl">Already seen</div></div>
      <div class="kpi red"    data-kpi="filtered"             title="Click to filter by any filtered_*">     <div class="val" id="kpiFiltered">\${data.filtered}</div>   <div class="lbl">Filtered</div></div>
      <div class="kpi purple static">                                                                      <div class="val" id="kpiSalary">\${data.salaryCount}</div>  <div class="lbl">With salary</div></div>
    </div>

    <div id="filterBar" class="filter-bar empty"></div>

    <section class="section open" data-section="overview">
      <div class="section-header">
        <span class="chev">▶</span>
        <h2>Overview</h2>
        <span class="section-meta">6 visuals · click a slice to filter the table</span>
      </div>
      <div class="section-body">
        <div class="charts-grid">
          <div class="card" data-filter-key="outcome">\${cardTitle('Outcome breakdown', 'outcome')}<div class="chart-wrap"><canvas id="cOutcome"></canvas></div></div>
          <div class="card" data-filter-key="rag_rating">\${cardTitle('RAG rating (rated jobs)', 'rag')}<div class="chart-wrap"><canvas id="cRag"></canvas></div></div>
          <div class="card" data-filter-key="source">\${cardTitle('Jobs by source', 'source')}<div class="chart-wrap tall"><canvas id="cSource"></canvas></div></div>
          <div class="card" data-filter-key="search_name">\${cardTitle('Jobs by search', 'search')}<div class="chart-wrap tall"><canvas id="cSearch"></canvas></div></div>
          <div class="card" data-filter-key="salaryBucket">\${cardTitle('Salary range', 'salary')}<div class="chart-wrap"><canvas id="cSalary"></canvas></div></div>
          <div class="card" id="contractCard" data-filter-key="rateType">\${cardTitle('Contract rates', 'salary')}<div id="contractStats"></div></div>
        </div>
      </div>
    </section>

    <section class="section" data-section="quality">
      <div class="section-header">
        <span class="chev">▶</span>
        <h2>Source &amp; search quality</h2>
        <span class="section-meta">4 visuals · reliability and filter drivers</span>
      </div>
      <div class="section-body">
        <div class="charts-grid">
          <div class="card" data-filter-key="source">\${cardTitle('Source quality funnel', 'sourceQuality')}<div class="chart-wrap tall"><canvas id="cSourceQuality"></canvas></div></div>
          <div class="card" data-filter-key="source">\${cardTitle('Source reliability snapshot', 'reliability')}<div class="chart-wrap"><canvas id="cReliability"></canvas></div></div>
          <div class="card" data-filter-key="search_name">\${cardTitle('Search effectiveness heatmap', 'searchHeatmap')}<div class="chart-wrap xtall"><canvas id="cSearchHeat"></canvas></div></div>
          <div class="card" data-filter-key="outcome">\${cardTitle('Filter pareto', 'pareto')}<div class="chart-wrap tall"><canvas id="cPareto"></canvas></div></div>
        </div>
      </div>
    </section>

    <section class="section" data-section="timing">
      <div class="section-header">
        <span class="chev">▶</span>
        <h2>Throughput &amp; timing</h2>
        <span class="section-meta">5 visuals · sequence, SPC and schedule</span>
      </div>
      <div class="section-body">
        <div class="charts-grid">
          <div class="card">\${cardTitle('Outcomes over sequence', 'outcomesOverTime')}<div class="chart-wrap tall"><canvas id="cOutcomeTime"></canvas></div></div>
          <div class="card">\${cardTitle('SPC control view (notified)', 'control')}<div class="chart-wrap"><canvas id="cControl"></canvas></div></div>
          <div class="card">\${cardTitle('Run throughput view', 'throughput')}<div class="chart-wrap"><canvas id="cThroughput"></canvas></div></div>
          <div class="card">\${cardTitle('Schedule heatmap', 'schedule')}<div class="chart-wrap xtall"><canvas id="cSchedule"></canvas></div></div>
          <div class="card" data-filter-key="outcome">\${cardTitle('Relevance vs outcome scatter', 'scatter')}<div class="chart-wrap"><canvas id="cScatter"></canvas></div></div>
        </div>
      </div>
    </section>

    <section class="section" data-section="about">
      <div class="section-header">
        <span class="chev">▶</span>
        <h2>About the data</h2>
        <span class="section-meta">pipeline diagram and glossary</span>
      </div>
      <div class="section-body">
        <div class="diagram-card">
          <div class="diagram-header">
            <span class="diagram-title">Pipeline + data model (selected csv)</span>
            <span class="scope-badge">Scope: \${escHtml(selectedFile)}</span>
          </div>
          <div class="diagram-grid">
            <div class="diagram-box">
              <h2>\${cardTitle('How pipeline works', 'pipeline').replace('<h2>','').replace('</h2>','')}</h2>
              <div class="diagram-flow">
                <div class="flow-step">Source adapters</div>
                <div class="flow-step">Normalize fields</div>
                <div class="flow-step">Dedup in SQLite</div>
                <div class="flow-step">Seniority + relevance filters</div>
                <div class="flow-step">Discord notify + CSV row logging</div>
              </div>
            </div>
            <div class="diagram-box">
              <h2>\${cardTitle('CSV schema and derived metrics', 'schema').replace('<h2>','').replace('</h2>','')}</h2>
              <div class="schema-row">
                <div class="schema-node">CSV row fields<br/><small>source, search, outcome, rag, salary, posted_at</small></div>
                <div class="schema-join">→</div>
                <div class="schema-node">Derived panels<br/><small>funnel, pareto, heatmaps, control view, scatter</small></div>
              </div>
            </div>
          </div>
        </div>
        \${renderHelpGlossary()}
      </div>
    </section>

    <section class="section open" data-section="table">
      <div class="section-header">
        <span class="chev">▶</span>
        <h2>Data table</h2>
        <span class="section-meta">filterable grid · use chart slices or chips to narrow down</span>
      </div>
      <div class="section-body">
        \${buildTableHTML(tableRows)}
      </div>
    </section>
  \`;

  // charts
  const outLabels = Object.keys(data.byOutcome);
  mkChart('cOutcome', 'doughnut', outLabels, [{
    data: outLabels.map(l => data.byOutcome[l]),
    backgroundColor: outLabels.map(l => OUTCOME_COLORS[l] || '#6366f1'),
    borderWidth: 2, borderColor: '#1a1d27',
  }], { onPick: ({ label }) => toggleCrossFilter('outcome', label) });

  const ragLabels = Object.keys(data.byRag);
  if (ragLabels.length) {
    mkChart('cRag', 'doughnut', ragLabels, [{
      data: ragLabels.map(l => data.byRag[l]),
      backgroundColor: ragLabels.map(l => RAG_COLORS[l] || '#94a3b8'),
      borderWidth: 2, borderColor: '#1a1d27',
    }], { onPick: ({ label }) => toggleCrossFilter('rag_rating', label) });
  } else {
    document.getElementById('cRag').closest('.card')
      .insertAdjacentHTML('beforeend', '<p style="color:#64748b;font-size:.82rem;margin-top:.5rem">No rated jobs in this run</p>');
  }

  const srcLabels = Object.keys(data.bySource).sort((a,b) => data.bySource[b]-data.bySource[a]);
  mkChart('cSource', 'bar', srcLabels, [{
    label: 'Jobs', data: srcLabels.map(l => data.bySource[l]),
    backgroundColor: PALETTE.slice(0, srcLabels.length), borderRadius: 4,
  }], {
    plugins: { legend: { display: false } },
    onPick: ({ label }) => toggleCrossFilter('source', label),
  });

  const srchLabels = Object.keys(data.bySearch).sort((a,b) => data.bySearch[b]-data.bySearch[a]);
  mkChart('cSearch', 'bar', srchLabels, [{
    label: 'Jobs', data: srchLabels.map(l => data.bySearch[l]),
    backgroundColor: PALETTE.slice(0, srchLabels.length), borderRadius: 4,
  }], {
    indexAxis: 'y',
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: '#94a3b8', font: { size: 11 } }, grid: { color: '#1e2235' } },
      y: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: '#1e2235' } },
    },
    onPick: ({ label }) => toggleCrossFilter('search_name', label),
  });

  const sLabels = Object.keys(data.salaryBuckets);
  mkChart('cSalary', 'bar', sLabels, [{
    label: 'Jobs', data: sLabels.map(l => data.salaryBuckets[l]),
    backgroundColor: '#6366f1', borderRadius: 4,
  }], {
    plugins: { legend: { display: false } },
    onPick: ({ label }) => toggleCrossFilter('salaryBucket', label),
  });

  const sq = analytics.sourceQuality || [];
  mkChart('cSourceQuality', 'bar', sq.map(s => s.source), [
    { label: 'Fetched', data: sq.map(s => s.fetched), backgroundColor: '#334155' },
    { label: 'Passed', data: sq.map(s => s.passed), backgroundColor: '#22d3ee' },
    { label: 'Notified', data: sq.map(s => s.notified), backgroundColor: '#4ade80' },
  ], {
    scales: { x: { stacked: true, ticks: { color: '#94a3b8', font: { size: 10 }, autoSkip: false } }, y: { stacked: true, ticks: { color: '#94a3b8' } } },
    onPick: ({ label }) => toggleCrossFilter('source', label),
  });

  mkChart('cOutcomeTime', 'bar', sequence.labels, [
    { label: 'Notified', data: sequence.notified, backgroundColor: '#4ade80' },
    { label: 'Filtered', data: sequence.filtered, backgroundColor: '#f87171' },
    { label: 'Fetched', data: sequence.fetched, backgroundColor: '#60a5fa' },
  ], { scales: { x: { stacked: true, ticks: { color: '#94a3b8', maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } }, y: { stacked: true, ticks: { color: '#94a3b8' } } } });

  const pareto = analytics.pareto || [];
  mkChart('cPareto', 'bar', pareto.map(p => p.label.replace('filtered_', '')), [
    { label: 'Count', data: pareto.map(p => p.value), backgroundColor: '#f59e0b', yAxisID: 'y' },
    { label: 'Cumulative %', data: pareto.map(p => p.cumulativePct), type: 'line', borderColor: '#a78bfa', backgroundColor: '#a78bfa', yAxisID: 'y1', tension: .2 },
  ], {
    scales: { y: { ticks: { color: '#94a3b8' } }, y1: { position: 'right', min: 0, max: 100, ticks: { color: '#a78bfa', callback: v => v + '%' }, grid: { drawOnChartArea: false } } },
    onPick: ({ index }) => { const full = pareto[index]?.label; if (full) toggleCrossFilter('outcome', full); },
  });

  const searchEff = (analytics.searchEffectiveness || []).slice(0, 14);
  const heatOutcomes = ['new', 'already_seen', 'filtered_match', 'filtered_seniority', 'filtered_salary', 'filtered_rag'];
  const searchHeatData = [];
  searchEff.forEach((s, yi) => {
    heatOutcomes.forEach((o, xi) => {
      const pct = ((s.byOutcome[o] || 0) / Math.max(1, s.total)) * 100;
      searchHeatData.push({ x: xi, y: yi, r: 8, pct, label: s.search, outcome: o });
    });
  });
  mkChart('cSearchHeat', 'bubble', [], [{ label: 'Outcome %', data: searchHeatData, backgroundColor: searchHeatData.map(p => colorFromPercent(p.pct)) }], {
    parsing: false,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ctx.raw.label + ' · ' + ctx.raw.outcome + ': ' + ctx.raw.pct.toFixed(1) + '%' } } },
    scales: {
      x: { type: 'linear', min: -0.5, max: heatOutcomes.length - 0.5, ticks: { stepSize: 1, color: '#94a3b8', callback: v => heatOutcomes[v] || '' } },
      y: { type: 'linear', min: -0.5, max: Math.max(0, searchEff.length - 0.5), ticks: { stepSize: 1, color: '#94a3b8', callback: v => (searchEff[v]?.search || '').slice(0, 18) } },
    },
    onPick: ({ raw }) => { if (raw?.label) toggleCrossFilter('search_name', raw.label); },
  });

  mkChart('cReliability', 'bar', sq.map(s => s.source), [{
    label: 'Reliability %', data: sq.map(s => s.reliability), backgroundColor: sq.map(s => colorFromPercent(s.reliability)),
  }], {
    plugins: { legend: { display: false } },
    scales: { y: { min: 0, max: 100, ticks: { color: '#94a3b8', callback: v => v + '%' } }, x: { ticks: { color: '#94a3b8' } } },
    onPick: ({ label }) => toggleCrossFilter('source', label),
  });

  mkChart('cControl', 'line', sequence.labels, [
    { label: 'Notified', data: sequence.notified, borderColor: '#4ade80', backgroundColor: '#4ade80', tension: .25 },
    { label: 'Mean', data: sequence.labels.map(() => sequence.control.mean), borderColor: '#94a3b8', borderDash: [6, 4], pointRadius: 0 },
    { label: 'UCL', data: sequence.labels.map(() => sequence.control.ucl), borderColor: '#f59e0b', borderDash: [4, 4], pointRadius: 0 },
    { label: 'LCL', data: sequence.labels.map(() => sequence.control.lcl), borderColor: '#fb7185', borderDash: [4, 4], pointRadius: 0 },
  ], { scales: { x: { ticks: { color: '#94a3b8', maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } }, y: { ticks: { color: '#94a3b8' } } } });

  mkChart('cThroughput', 'line', sequence.labels, [
    { label: 'Fetched cumulative', data: sequence.cumulativeFetched, borderColor: '#60a5fa', backgroundColor: '#60a5fa', tension: .2 },
    { label: 'Notified cumulative', data: sequence.cumulativeNotified, borderColor: '#4ade80', backgroundColor: '#4ade80', tension: .2 },
    { label: 'Filtered cumulative', data: sequence.cumulativeFiltered, borderColor: '#f87171', backgroundColor: '#f87171', tension: .2 },
  ], { scales: { x: { ticks: { color: '#94a3b8', maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } }, y: { ticks: { color: '#94a3b8' } } } });

  const scheduleData = [];
  const scheduleMatrix = analytics.schedule || [];
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const cnt = scheduleMatrix[d]?.[h] || 0;
      if (!cnt) continue;
      scheduleData.push({ x: h, y: d, r: Math.min(12, 4 + cnt), cnt });
    }
  }
  mkChart('cSchedule', 'bubble', [], [{ label: 'Jobs', data: scheduleData, backgroundColor: scheduleData.map(p => colorFromPercent(Math.min(100, p.cnt * 15))) }], {
    parsing: false,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => DOW_LABELS[ctx.raw.y] + ' ' + String(ctx.raw.x).padStart(2, '0') + ':00 · ' + ctx.raw.cnt + ' jobs' } } },
    scales: {
      x: { type: 'linear', min: -0.5, max: 23.5, ticks: { color: '#94a3b8', stepSize: 2 } },
      y: { type: 'linear', min: -0.5, max: 6.5, ticks: { color: '#94a3b8', stepSize: 1, callback: v => DOW_LABELS[v] || '' } },
    },
  });

  const scatter = analytics.ragScatter || [];
  mkChart('cScatter', 'scatter', [], [{
    label: 'RAG score', data: scatter, parsing: false,
    backgroundColor: scatter.map(p => OUTCOME_COLORS[p.outcome] || '#94a3b8'),
    pointRadius: 4,
  }], {
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => 'Row ' + ctx.raw.x + ' · score ' + ctx.raw.y + ' · ' + (ctx.raw.outcome || 'unknown') } } },
    scales: {
      x: { type: 'linear', ticks: { color: '#94a3b8' }, title: { display: true, text: 'Row order', color: '#64748b' } },
      y: { type: 'linear', ticks: { color: '#94a3b8' }, title: { display: true, text: 'RAG score', color: '#64748b' } },
    },
    onPick: ({ raw }) => { if (raw?.outcome) toggleCrossFilter('outcome', raw.outcome); },
  });

  // contract rates card
  const cr = data.contractRates || { day: [], hour: [] };
  const fmtK = v => '£' + Math.round(v / 1000) + 'k';
  const avg  = arr => arr.length ? Math.round(arr.reduce((a,b) => a+b,0) / arr.length) : null;
  const contractEl = document.getElementById('contractStats');
  if (contractEl) {
    if (!cr.day.length && !cr.hour.length) {
      contractEl.innerHTML = '<p style="color:#64748b;font-size:.82rem;margin-top:.5rem">No contract rates found in this run</p>';
    } else {
      const renderGroup = (items, unit, badge, rateType) => {
        if (!items.length) return '';
        const raws    = items.map(i => i.raw);
        const netMins = items.map(i => i.netMin);
        const netMaxs = items.map(i => i.netMax);
        const avgRate  = avg(raws);
        const avgNet   = avg(netMins.map((lo,i) => Math.round((lo + netMaxs[i]) / 2)));
        const minNet   = Math.min(...netMins);
        const maxNet   = Math.max(...netMaxs);
        return \`<div class="cr-row" data-rate-type="\${rateType}" style="cursor:pointer" title="Click to filter table by \${rateType} contracts">
          <span class="badge \${badge}">\${unit === '/day' ? 'Daily' : 'Hourly'}</span>
          <span class="cr-count">\${items.length} role\${items.length!==1?'s':''}</span>
          <span class="cr-range">£\${Math.min(...raws)}–£\${Math.max(...raws)}\${unit} · avg £\${avgRate}\${unit}</span>
          <span class="cr-yearly"><span class="yearly-net">\${fmtK(minNet)}–\${fmtK(maxNet)} net equiv/yr</span> · avg \${fmtK(avgNet)}</span>
        </div>\`;
      };
      contractEl.innerHTML =
        '<p class="cr-note">220 billable days · 7.5 hr/day · ~22.5% cost deduction</p>' +
        renderGroup(cr.day,  '/day', 'rate-day',  'day') +
        renderGroup(cr.hour, '/hr',  'rate-hour', 'hour');
      contractEl.querySelectorAll('.cr-row[data-rate-type]').forEach(row => {
        row.addEventListener('click', () => toggleCrossFilter('rateType', row.dataset.rateType));
      });
    }
  }

  // KPI clicks — filter table by outcome
  document.querySelectorAll('.kpi[data-kpi-outcome]').forEach(el => {
    el.addEventListener('click', () => toggleCrossFilter('outcome', el.dataset.kpiOutcome));
  });
  const kpiFiltered = document.querySelector('.kpi[data-kpi="filtered"]');
  if (kpiFiltered) {
    kpiFiltered.addEventListener('click', () => {
      const active = crossFilters.outcome && [...crossFilters.outcome].every(v => v.startsWith('filtered'));
      if (active) { clearCrossFilters(); return; }
      const filteredOutcomes = Object.keys(data.byOutcome).filter(k => k.startsWith('filtered'));
      crossFilters = { outcome: new Set(filteredOutcomes) };
      syncCrossFilterUI();
    });
  }

  initTableEvents();
  renderTable();
  initHelpTips();
  initSectionToggles();
  renderFilterBar();
  markActiveCards();
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Boot ──────────────────────────────────────────────────────────────────────
async function loadFile(filename) {
  document.getElementById('main').innerHTML = '<div id="loading">Loading…</div>';
  const res = await fetch(API_BASE + '/api/data?file=' + encodeURIComponent(filename));
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  const d = data.runAt ? new Date(data.runAt).toLocaleString('en-GB') : '';
  document.getElementById('meta').textContent = d + (data.trigger ? '  ·  ' + data.trigger : '');
  render(data);
}

let trendChart = null;
async function loadTrend() {
  try {
    const res = await fetch(API_BASE + '/api/trend?limit=30');
    if (!res.ok) return;
    const { series } = await res.json();
    const section = document.getElementById('trendSection');
    if (!series || series.length < 2) { section.style.display = 'none'; return; }
    section.style.display = 'block';

    const labels = series.map(s => {
      const d = s.runAt ? new Date(s.runAt) : null;
      return d && !isNaN(d) ? d.toLocaleString('en-GB', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : s.file;
    });
    const notifyRate = series.map(s => s.notifyRate);
    const fetched    = series.map(s => s.fetched);
    const notified   = series.map(s => s.notified);

    // trailing 7-run mean as a "yesterday's baseline" reference
    const baseline = notifyRate.map((_, i) => {
      const window = notifyRate.slice(Math.max(0, i - 6), i + 1);
      return Math.round((window.reduce((a, b) => a + b, 0) / window.length) * 10) / 10;
    });

    if (trendChart) trendChart.destroy();
    const ctx = document.getElementById('cTrend');
    trendChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Notify rate %', data: notifyRate, borderColor: '#4ade80', backgroundColor: 'rgba(74,222,128,.12)', yAxisID: 'y', tension: .25, fill: true },
          { label: '7-run mean',    data: baseline,   borderColor: '#a5b4fc', borderDash: [6, 4], yAxisID: 'y', tension: .25, pointRadius: 0 },
          { label: 'Fetched',       data: fetched,    borderColor: '#60a5fa', yAxisID: 'y1', tension: .25, pointRadius: 0, hidden: true },
          { label: 'Notified',      data: notified,   borderColor: '#fbbf24', yAxisID: 'y1', tension: .25, pointRadius: 0, hidden: true },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: '#cbd5e1' } } },
        scales: {
          x:  { ticks: { color: '#64748b', maxRotation: 0, autoSkip: true } },
          y:  { position: 'left',  ticks: { color: '#4ade80', callback: v => v + '%' }, grid: { color: '#1e2235' }, beginAtZero: true },
          y1: { position: 'right', ticks: { color: '#94a3b8' }, grid: { display: false } },
        },
      },
    });
  } catch { /* silently skip trend chart on errors */ }
}

async function init() {
  const res = await fetch(API_BASE + '/api/files');
  const files = await res.json();
  const sel = document.getElementById('fileSelect');
  files.forEach((f, i) => {
    const opt = document.createElement('option');
    opt.value = f;
    opt.textContent = f.replace(/^run_/, '').replace(/(_oneshot|_bot)\\.csv$/, ' ($1).csv');
    if (i === 0) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => loadFile(sel.value));
  loadTrend();
  if (files.length) await loadFile(files[0]);
  else document.getElementById('main').innerHTML = '<div id="error">No CSV files found in logs/runs/</div>';
}

init().catch(e => {
  document.getElementById('main').innerHTML = '<div id="error">' + e.message + '</div>';
});

// ── Bot controls ──────────────────────────────────────────────────────────────
const logPanel      = document.getElementById('logPanel');
const stateBadge    = document.getElementById('botStateBadge');
const runOnceBtn    = document.getElementById('runOnceBtn');
const startBotBtn   = document.getElementById('startBotBtn');
const stopBotBtn    = document.getElementById('stopBotBtn');
let   needsRefresh  = false;

function applyStatus(s) {
  stateBadge.className = s.state;
  stateBadge.textContent = s.state === 'running'
    ? (s.mode === 'once' ? 'running (once)' : 'running (bot)')
    : s.state;
  const running = s.state === 'running';
  runOnceBtn.disabled  = running;
  startBotBtn.disabled = running;
  runOnceBtn.style.display  = running ? 'none' : '';
  startBotBtn.style.display = running ? 'none' : '';
  stopBotBtn.style.display  = running ? ''     : 'none';
  if (!running && needsRefresh) { needsRefresh = false; refreshFiles(); }
}

async function refreshFiles() {
  try {
    const res   = await fetch(API_BASE + '/api/files');
    const files = await res.json();
    const sel   = document.getElementById('fileSelect');
    const cur   = sel.value;
    sel.innerHTML = '';
    files.forEach((f, i) => {
      const opt = document.createElement('option');
      opt.value = f;
      opt.textContent = f.replace(/^run_/, '').replace(/(_oneshot|_bot)\\.csv$/, ' ($1).csv');
      sel.appendChild(opt);
    });
    // keep selection or auto-load newest
    if (files.includes(cur)) {
      sel.value = cur;
    } else if (files.length) {
      sel.value = files[0];
      loadFile(files[0]);
    }
    loadTrend();
  } catch (_) {}
}

async function botAction(action) {
  const token = localStorage.getItem('dashboardToken') || '';
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-Dashboard-Token'] = token;

  const res = await fetch(API_BASE + '/api/bot/' + action, { method: 'POST', headers });
  if (res.status === 401) {
    const t = prompt('Enter Dashboard Token:');
    if (t) { localStorage.setItem('dashboardToken', t); botAction(action); }
    return;
  }
  if (!res.ok) { alert(await res.text()); }
}

runOnceBtn.addEventListener('click', () => {
  logPanel.textContent = '';
  logPanel.style.display = 'block';
  needsRefresh = true;
  botAction('start-once');
});

startBotBtn.addEventListener('click', () => {
  logPanel.textContent = '';
  logPanel.style.display = 'block';
  botAction('start-daemon');
});

stopBotBtn.addEventListener('click', () => botAction('stop'));

// SSE connection
function connectSSE() {
  const es = new EventSource(API_BASE + '/api/bot/stream');
  es.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'status') applyStatus(msg.status);
    if (msg.type === 'log') {
      logPanel.textContent += msg.line;
      logPanel.scrollTop = logPanel.scrollHeight;
    }
  };
  es.onerror = () => { es.close(); setTimeout(connectSSE, 3000); };
}

// Load initial bot state then open SSE
fetch(API_BASE + '/api/bot/status').then(r => r.json()).then(s => { applyStatus(s); connectSSE(); });
</script>
</body>
</html>`;

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = BASE_PATH && url.pathname.startsWith(BASE_PATH)
    ? url.pathname.slice(BASE_PATH.length) || '/'
    : url.pathname;

  if (pathname === '/api/files') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(listCsvFiles()));
    return;
  }

  // ── Bot control endpoints ─────────────────────────────────────────────────
  if (pathname === '/api/bot/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(botStatus));
    return;
  }

  if (pathname === '/api/bot/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    });
    res.write(`data: ${JSON.stringify({ type: 'status', status: botStatus })}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  if ((pathname === '/api/bot/start-once' || pathname === '/api/bot/start-daemon') && req.method === 'POST') {
    if (TOKEN && req.headers['x-dashboard-token'] !== TOKEN) {
      res.writeHead(401); res.end('Unauthorized'); return;
    }
    if (botProc) { res.writeHead(409); res.end('Already running'); return; }
    const mode = pathname.endsWith('once') ? 'once' : 'daemon';
    startBot(mode);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (pathname === '/api/bot/stop' && req.method === 'POST') {
    if (TOKEN && req.headers['x-dashboard-token'] !== TOKEN) {
      res.writeHead(401); res.end('Unauthorized'); return;
    }
    if (botProc) { botProc.kill('SIGTERM'); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (pathname === '/api/data') {
    const file = url.searchParams.get('file');
    if (!file || file.includes('..') || !file.endsWith('.csv')) {
      res.writeHead(400); res.end('Bad file param'); return;
    }
    const filePath = path.join(RUNS_DIR, file);
    if (!fs.existsSync(filePath)) {
      res.writeHead(404); res.end('Not found'); return;
    }
    try {
      const data = getAggregate(filePath, file);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(500); res.end(e.message);
    }
    return;
  }

  if (pathname === '/api/trend') {
    const limit = Math.min(100, Math.max(5, Number(url.searchParams.get('limit')) || 30));
    const files = listCsvFiles().slice(0, limit).reverse(); // oldest → newest
    const series = [];
    for (const f of files) {
      try {
        const data = getAggregate(path.join(RUNS_DIR, f), f);
        const fetched = data.total || 0;
        series.push({
          file: f,
          runAt: data.runAt || '',
          trigger: data.trigger || '',
          fetched,
          notified: data.notified || 0,
          alreadySeen: data.alreadySeen || 0,
          filtered: data.filtered || 0,
          notifyRate: fetched ? Math.round((data.notified / fetched) * 1000) / 10 : 0,
        });
      } catch { /* skip unreadable files */ }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ series }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(HTML);
});

server.listen(PORT, HOST, () => {
  const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`Dashboard running → http://${displayHost}:${PORT}`);
  if (TOKEN) console.log('Dashboard token protection: enabled');
  if (!LOOPBACK_HOSTS.has(HOST)) console.log(`Dashboard bound to non-loopback host ${HOST}; token required on bot-control endpoints.`);
});
