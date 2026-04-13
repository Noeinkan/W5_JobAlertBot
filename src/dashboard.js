/**
 * Dashboard server — browse run CSVs in the browser.
 * Usage: node src/dashboard.js [--port 3099]
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNS_DIR = path.join(__dirname, '..', 'logs', 'runs');

const portArg = process.argv.indexOf('--port');
const PORT = portArg !== -1 ? parseInt(process.argv[portArg + 1], 10) : 3099;
const HOST      = process.env.DASHBOARD_HOST      || '0.0.0.0';
const TOKEN     = process.env.DASHBOARD_TOKEN     || '';  // optional bearer token
const BASE_PATH = (process.env.DASHBOARD_BASE_PATH || '').replace(/\/$/, ''); // e.g. '/job_dashboard'

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
  for (const v of salaryVals) {
    const k = v / 1000;
    if      (k < 30)  salaryBuckets['<30k']++;
    else if (k < 50)  salaryBuckets['30-50k']++;
    else if (k < 70)  salaryBuckets['50-70k']++;
    else if (k < 100) salaryBuckets['70-100k']++;
    else              salaryBuckets['>100k']++;
  }

  return {
    total:       rows.length,
    notified:    rows.filter(r => r.outcome === 'notified').length,
    alreadySeen: rows.filter(r => r.outcome === 'already_seen').length,
    filtered:    rows.filter(r => r.outcome?.startsWith('filtered')).length,
    salaryCount: salaryVals.length,
    runAt:       rows[0]?.run_at  ?? '',
    trigger:     rows[0]?.trigger ?? '',
    byOutcome, bySource, bySearch, byRag, salaryBuckets,
    contractRates,
    rows,
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
body{font-family:system-ui,sans-serif;background:#0f1117;color:#e2e8f0;min-height:100vh}
header{background:#1a1d27;padding:.8rem 1.5rem;display:flex;align-items:center;gap:1rem;border-bottom:1px solid #2d3148;position:sticky;top:0;z-index:100}
header h1{font-size:1rem;font-weight:600;color:#a5b4fc;flex:1}
select{background:#252836;color:#e2e8f0;border:1px solid #3d4268;border-radius:6px;padding:.35rem .7rem;font-size:.85rem;cursor:pointer}
select:focus{outline:2px solid #6366f1}
#meta{font-size:.78rem;color:#64748b;white-space:nowrap}
main{padding:1.25rem;display:grid;gap:1.25rem}
.kpi-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:1rem}
.kpi{background:#1a1d27;border:1px solid #2d3148;border-radius:10px;padding:.9rem 1.1rem}
.kpi .val{font-size:1.9rem;font-weight:700;line-height:1}
.kpi .lbl{font-size:.72rem;color:#94a3b8;margin-top:.3rem;text-transform:uppercase;letter-spacing:.05em}
.kpi.green  .val{color:#4ade80}
.kpi.amber  .val{color:#fbbf24}
.kpi.red    .val{color:#f87171}
.kpi.blue   .val{color:#60a5fa}
.kpi.purple .val{color:#a78bfa}
.charts-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:1.25rem}
.card{background:#1a1d27;border:1px solid #2d3148;border-radius:10px;padding:1.1rem}
.card h2{font-size:.78rem;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin-bottom:.9rem}
.chart-wrap{position:relative;height:210px}
.chart-wrap.tall{height:270px}

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
.table-wrap{overflow-x:auto;border-radius:6px;border:1px solid #2d3148}
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
.badge.notified         {background:#14532d;color:#4ade80}
.badge.already_seen     {background:#1e3a5f;color:#60a5fa}
.badge.filtered_seniority{background:#3b1111;color:#f87171}
.badge.filtered_salary  {background:#3b2e08;color:#fbbf24}
.badge.filtered_match   {background:#3b1f08;color:#fb923c}
.badge.filtered_relevance{background:#2e0f3b;color:#e879f9}
.badge.error            {background:#1e2235;color:#94a3b8}
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
#botStateBadge{font-size:.75rem;padding:.2rem .55rem;border-radius:4px;font-weight:600;white-space:nowrap}
#botStateBadge.idle   {background:#1e2235;color:#64748b}
#botStateBadge.running{background:#0c2a3b;color:#38bdf8;animation:pulse 1.4s ease-in-out infinite}
#botStateBadge.done   {background:#14532d;color:#4ade80}
#botStateBadge.error  {background:#3b1111;color:#f87171}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.55}}
#logPanel{background:#0b0d12;border-bottom:1px solid #2d3148;padding:.6rem 1.25rem;font-family:monospace;font-size:.73rem;color:#94a3b8;max-height:200px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;display:none}
</style>
</head>
<body>
<header>
  <h1>Job Alert Bot — Run Dashboard</h1>
  <select id="fileSelect"></select>
  <span id="meta"></span>
  <span id="botStateBadge" class="idle">idle</span>
  <button id="runOnceBtn" class="run-btn" title="Run one fetch cycle now">▶ Run Once</button>
  <button id="startBotBtn" class="run-btn" title="Start the bot scheduler (npm start)">▶ Start Bot</button>
  <button id="stopBotBtn"  class="run-btn stop" title="Stop the running process" style="display:none">■ Stop</button>
</header>
<div id="logPanel"></div>
<main id="main">
  <div id="loading">Loading…</div>
</main>

<script>
const API_BASE = '${BASE_PATH}';
// ── Constants ─────────────────────────────────────────────────────────────────
const OUTCOME_COLORS = {
  notified:           '#4ade80',
  already_seen:       '#60a5fa',
  filtered_seniority: '#f87171',
  filtered_salary:    '#fbbf24',
  filtered_match:     '#fb923c',
  filtered_relevance: '#e879f9',
  error:              '#94a3b8',
};
const RAG_COLORS = { Green: '#4ade80', Amber: '#fbbf24', Red: '#f87171' };
const PALETTE = ['#6366f1','#22d3ee','#f59e0b','#10b981','#ec4899','#a78bfa','#fb923c','#38bdf8','#84cc16','#e11d48'];

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
      ...extra,
    },
  }));
}

// ── Table state ───────────────────────────────────────────────────────────────
let tableRows  = [];
let sortCol    = null;
let sortDir    = 'asc';   // 'asc' | 'desc'
let colFilters = {};      // { colKey: string }
let globalQ    = '';

function getVisible() {
  let rows = tableRows;

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

  const main = document.getElementById('main');
  main.innerHTML = \`
    <div class="kpi-row">
      <div class="kpi blue">  <div class="val">\${data.total}      </div><div class="lbl">Total fetched</div></div>
      <div class="kpi green"> <div class="val">\${data.notified}   </div><div class="lbl">Notified</div></div>
      <div class="kpi amber"> <div class="val">\${data.alreadySeen}</div><div class="lbl">Already seen</div></div>
      <div class="kpi red">   <div class="val">\${data.filtered}   </div><div class="lbl">Filtered</div></div>
      <div class="kpi purple"><div class="val">\${data.salaryCount}</div><div class="lbl">With salary</div></div>
    </div>
    <div class="charts-grid">
      <div class="card"><h2>Outcome breakdown</h2>      <div class="chart-wrap"><canvas id="cOutcome"></canvas></div></div>
      <div class="card"><h2>RAG rating (rated jobs)</h2><div class="chart-wrap"><canvas id="cRag"></canvas></div></div>
      <div class="card"><h2>Jobs by source</h2>         <div class="chart-wrap tall"><canvas id="cSource"></canvas></div></div>
      <div class="card"><h2>Jobs by search</h2>         <div class="chart-wrap tall"><canvas id="cSearch"></canvas></div></div>
      <div class="card"><h2>Salary range</h2>           <div class="chart-wrap"><canvas id="cSalary"></canvas></div></div>
      <div class="card" id="contractCard"><h2>Contract rates</h2><div id="contractStats"></div></div>
    </div>
    \${buildTableHTML(tableRows)}
  \`;

  // charts
  const outLabels = Object.keys(data.byOutcome);
  mkChart('cOutcome', 'doughnut', outLabels, [{
    data: outLabels.map(l => data.byOutcome[l]),
    backgroundColor: outLabels.map(l => OUTCOME_COLORS[l] || '#6366f1'),
    borderWidth: 2, borderColor: '#1a1d27',
  }]);

  const ragLabels = Object.keys(data.byRag);
  if (ragLabels.length) {
    mkChart('cRag', 'doughnut', ragLabels, [{
      data: ragLabels.map(l => data.byRag[l]),
      backgroundColor: ragLabels.map(l => RAG_COLORS[l] || '#94a3b8'),
      borderWidth: 2, borderColor: '#1a1d27',
    }]);
  } else {
    document.getElementById('cRag').closest('.card')
      .insertAdjacentHTML('beforeend', '<p style="color:#64748b;font-size:.82rem;margin-top:.5rem">No rated jobs in this run</p>');
  }

  const srcLabels = Object.keys(data.bySource).sort((a,b) => data.bySource[b]-data.bySource[a]);
  mkChart('cSource', 'bar', srcLabels, [{
    label: 'Jobs', data: srcLabels.map(l => data.bySource[l]),
    backgroundColor: PALETTE.slice(0, srcLabels.length), borderRadius: 4,
  }], { plugins: { legend: { display: false } } });

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
  });

  const sLabels = Object.keys(data.salaryBuckets);
  mkChart('cSalary', 'bar', sLabels, [{
    label: 'Jobs', data: sLabels.map(l => data.salaryBuckets[l]),
    backgroundColor: '#6366f1', borderRadius: 4,
  }], { plugins: { legend: { display: false } } });

  // contract rates card
  const cr = data.contractRates || { day: [], hour: [] };
  const fmtK = v => '£' + Math.round(v / 1000) + 'k';
  const avg  = arr => arr.length ? Math.round(arr.reduce((a,b) => a+b,0) / arr.length) : null;
  const contractEl = document.getElementById('contractStats');
  if (contractEl) {
    if (!cr.day.length && !cr.hour.length) {
      contractEl.innerHTML = '<p style="color:#64748b;font-size:.82rem;margin-top:.5rem">No contract rates found in this run</p>';
    } else {
      const renderGroup = (items, unit, badge) => {
        if (!items.length) return '';
        const raws    = items.map(i => i.raw);
        const netMins = items.map(i => i.netMin);
        const netMaxs = items.map(i => i.netMax);
        const avgRate  = avg(raws);
        const avgNet   = avg(netMins.map((lo,i) => Math.round((lo + netMaxs[i]) / 2)));
        const minNet   = Math.min(...netMins);
        const maxNet   = Math.max(...netMaxs);
        return \`<div class="cr-row">
          <span class="badge \${badge}">\${unit === '/day' ? 'Daily' : 'Hourly'}</span>
          <span class="cr-count">\${items.length} role\${items.length!==1?'s':''}</span>
          <span class="cr-range">£\${Math.min(...raws)}–£\${Math.max(...raws)}\${unit} · avg £\${avgRate}\${unit}</span>
          <span class="cr-yearly"><span class="yearly-net">\${fmtK(minNet)}–\${fmtK(maxNet)} net equiv/yr</span> · avg \${fmtK(avgNet)}</span>
        </div>\`;
      };
      contractEl.innerHTML =
        '<p class="cr-note">220 billable days · 7.5 hr/day · ~22.5% cost deduction</p>' +
        renderGroup(cr.day,  '/day', 'rate-day') +
        renderGroup(cr.hour, '/hr',  'rate-hour');
    }
  }

  initTableEvents();
  renderTable();
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
      const raw = fs.readFileSync(filePath, 'utf8');
      const rows = parseCsv(raw);
      const data = aggregate(rows);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(500); res.end(e.message);
    }
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(HTML);
});

server.listen(PORT, HOST, () => {
  console.log(`Dashboard running → http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  if (TOKEN) console.log('Dashboard token protection: enabled');
});
