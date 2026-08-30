// ─────────────────────────────────────────────────────────────────────────────
// dashboard-app split 1/7 — app-core.js
// HTTP/auth, constants, colors, column defs, layout+template storage, getCols
// Classic <script> sharing ONE global scope with its siblings. Load order in
// server.js buildDashboardHtml() matters; app-bootstrap.js must load last.
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = window.__DASHBOARD_BASE__ ?? '';

async function fetchWithDashboardToken(url, options = {}) {
  const hdr = () => {
    const headers = { ...(options.headers || {}) };
    const t = localStorage.getItem('dashboardToken') || '';
    if (t) headers['X-Dashboard-Token'] = t;
    return headers;
  };
  let res = await fetch(url, { ...options, headers: hdr() });
  if (res.status === 401) {
    const p = prompt('Enter Dashboard Token:');
    if (p) {
      localStorage.setItem('dashboardToken', p);
      res = await fetch(url, { ...options, headers: hdr() });
    }
  }
  return res;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const OUTCOME_COLORS = {
  new:                '#4ade80',
  already_seen:       '#60a5fa',
  applied:            '#818cf8',
  discarded:          '#475569',
  expired:            '#fb7185',
  filtered_seniority: '#f87171',
  filtered_salary:    '#fbbf24',
  filtered_match:     '#fb923c',
  filtered_rag:       '#e879f9',
  filtered_profile:        '#c084fc',
  filtered_profile_strict: '#a855f7',
};
const RAG_COLORS = { Green: '#4ade80', Amber: '#fbbf24', Red: '#f87171' };
const PALETTE = ['#6366f1','#22d3ee','#f59e0b','#10b981','#ec4899','#a78bfa','#fb923c','#38bdf8','#84cc16','#e11d48'];
const DOW_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const HELP_TEXT = {
  outcome: 'What: Distribution of row outcomes in this selected CSV. Why: Quickly see signal vs noise. Read: More notified with fewer filtered outcomes is better.',
  contractSplit: 'What: Split of rows between permanent roles and contractor roles. Why: See at a glance how much of the run is inside/outside IR35 territory. Read: Click a slice to narrow the table to just perm or just contract.',
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
  profileFit: 'What: Green/Amber/Red split for CV-aligned profile fit (when enabled). Why: Shows personal relevance vs generic lexicon RAG. Read: Tune patterns in data/profile.json.',
  pipeline: 'What: High-level ingest pipeline for selected CSV rows. Why: Explain where each metric comes from. Read: Each stage transforms or filters rows.',
  schema: 'What: CSV row schema and derived metric grouping. Why: Clarify data lineage for charts. Read: Derived views are computed only from current file.',
};

// ── Table columns (canonical defs + sensible default order) ──────────────────
const COL_DEFS = [
  { key: 'url',         label: 'Link',        type: 'text',   defaultWidth: 124, isLink: true, sticky: 1 },
  { key: 'title',       label: 'Title',       type: 'text',   defaultWidth: 220, sticky: 2 },
  { key: 'posted_at',   label: 'Published',   type: 'text',   defaultWidth: 130 },
  { key: 'outcome',     label: 'Outcome',     type: 'select', defaultWidth: 130 },
  { key: 'profile_rating', label: 'Profile',  type: 'select', defaultWidth: 72 },
  { key: 'profile_score',  label: 'Prof score', type: 'text', defaultWidth: 72 },
  { key: 'profile_reason', label: 'Prof reason', type: 'text', defaultWidth: 180, wrap: true },
  { key: 'rag_rating',  label: 'RAG',         type: 'select', defaultWidth: 72 },
  { key: 'rag_score',   label: 'Score',       type: 'text',   defaultWidth: 64 },
  { key: 'rag_reason',  label: 'Reason',      type: 'text',   defaultWidth: 200, wrap: true },
  { key: 'company',     label: 'Company',     type: 'text',   defaultWidth: 140 },
  { key: 'location',    label: 'Location',    type: 'text',   defaultWidth: 130 },
  { key: 'source',      label: 'Source',      type: 'select', defaultWidth: 100 },
  { key: 'search_name', label: 'Search',      type: 'select', defaultWidth: 150 },
  { key: 'salary_text', label: 'Salary',      type: 'text',   defaultWidth: 130 },
  { key: 'is_contract', label: 'Contract',    type: 'select', defaultWidth: 88 },
  { key: 'rateType',    label: 'Rate type',   type: 'select', defaultWidth: 88 },
  { key: 'rateDisplay', label: 'Rate',        type: 'text',   defaultWidth: 130, isRate: true },
  { key: 'yearlyGross', label: '~Gross/yr',   type: 'text',   defaultWidth: 120, isYearly: 'gross' },
  { key: 'yearlyNet',   label: '~Net equiv',  type: 'text',   defaultWidth: 120, isYearly: 'net' },
  { key: '_actions',      label: 'Actions',     type: 'actions', defaultWidth: 260 },
  { key: 'remote_type', label: 'Remote',      type: 'select', defaultWidth: 88 },
  { key: 'sectors',     label: 'Sectors',     type: 'text',   defaultWidth: 130 },
  { key: 'clearances',  label: 'Clearance',   type: 'select', defaultWidth: 92 },
  { key: 'found_at',    label: 'First seen',  type: 'text',   defaultWidth: 140 },
  { key: 'tech_tools',  label: 'Tools',       type: 'text',   defaultWidth: 180, wrap: true },
  { key: 'years_experience',       label: 'Years',       type: 'text', defaultWidth: 56 },
  { key: 'contract_length_months', label: 'Length (mo)', type: 'text', defaultWidth: 82 },
  { key: 'bonus_percent',   label: 'Bonus %',   type: 'text', defaultWidth: 76 },
  { key: 'car_allowance',   label: 'Car',       type: 'text', defaultWidth: 80 },
  { key: 'pension_percent', label: 'Pension %', type: 'text', defaultWidth: 80 },
  { key: 'has_equity',    label: 'Equity',      type: 'select', defaultWidth: 72 },
];
const COL_DEFS_MAP = Object.fromEntries(COL_DEFS.map(c => [c.key, c]));
const DEFAULT_COLUMN_ORDER = COL_DEFS.map(c => c.key);

// ── Per-column + per-value hover help ───────────────────────────────────────
// Shown when the user hovers over a cell. {col} placeholder is replaced with
// the column's human label so each chip reads naturally.
const COLUMN_HELP = {
  outcome: {
    base: 'Pipeline outcome for this row. {col} = where the job ended up after filtering, notification, or your dashboard action.',
    byValue: {
      new: 'Passed all filters and was sent to Discord as a new alert.',
      already_seen: 'Seen on a previous run — kept in the DB for the history table but not re-posted.',
      applied: 'You clicked Apply on this row in the dashboard.',
      discarded: 'You clicked Not relevant on this row in the dashboard.',
      expired: 'You marked this row as Expired (e.g. role closed on the source site).',
      filtered_seniority: 'Blocked by the seniority gate (e.g. below your target level, or wrong direction).',
      filtered_salary: 'Blocked because the salary fell outside your min/max band.',
      filtered_match: 'Blocked because the title/description didn\'t match search intent strongly enough.',
      filtered_rag: 'Blocked because the RAG score was too low (Red).',
      filtered_profile: 'Blocked because CV/profile fit was Red (PROFILE_FIT_ENABLED is on).',
      filtered_profile_strict: 'Blocked because PROFILE_FIT_STRICT is on and profile fit was Amber (only Green would pass).',
    },
  },
  profile_rating: {
    base: 'CV-aligned fit from {col} scoring against your patterns in data/profile.json. Only populated when PROFILE_FIT_ENABLED=true.',
    byValue: {
      Green: 'Strong match to your CV / target profile. Tuned via data/profile.json.',
      Amber: 'Partial match — review manually.',
      Red: 'Weak / off-target for your profile. Can be excluded automatically when PROFILE_FIT_STRICT=true.',
    },
  },
  profile_score: {
    base: 'Numeric score behind the {col} rating — the pattern-weighted total from data/profile.json.',
  },
  profile_reason: {
    base: 'Short explanation of which profile patterns fired for this row. Tune the patterns in data/profile.json to change what {col} matches.',
  },
  rag_rating: {
    base: 'Generic relevance rating (Green/Amber/Red) from src/utils/rag.js — weighted keyword scoring against the title and description. Independent of your CV.',
    byValue: {
      Green: 'Score ≥ 12 — strong RAG signal across title/domain/experience.',
      Amber: 'Score 5–11 — partial signal, worth a glance.',
      Red: 'Score < 5 or hit by a negative keyword (e.g. "junior", "graduate").',
    },
  },
  rag_score: {
    base: 'Numeric RAG score. ≥12 = Green, ≥5 = Amber, otherwise Red. Negative values mean the title/description triggered NON_AEC_DESC_BLOCKERS (e.g. data engineering, fintech).',
  },
  rag_reason: {
    base: 'Which RAG signal groups fired for this row — Title seniority, Domain keywords (BIM / digital delivery / ISO 19650 …), Experience signals, and Non-AEC negatives.',
  },
  url:        { base: 'Original job link. Click "open" to view on the source site; click "highlights" to see the stored description with search/RAG/profile terms highlighted.' },
  title:      { base: 'Job {col} as posted on the source site.' },
  posted_at:  { base: 'When the source site listed the job, formatted DD/MM/YYYY. Empty if the source didn\'t provide one.' },
  company:    { base: 'Employer {col} as posted. Sometimes blank on sources that hide it.' },
  location:   { base: 'Job {col} (city/town or "Remote").' },
  source:     { base: 'Which of the 25 source adapters fetched this row (Adzuna, Reed, LinkedIn, BIM+ Jobs, etc.).' },
  search_name:{ base: 'Configured search in data/searches.json that matched this row. One search can hit multiple sources.' },
  salary_text:{ base: 'Raw salary string from the source — the bot also parses salary_min / salary_max for the band charts.' },
  is_contract:{ base: 'Whether the role is a contractor position (often day-rate) or permanent. Detected from the title and salary text.' },
  rateType:   { base: 'Day-rate or hour-rate — derived from the salary string for contract roles.' },
  rateDisplay:{ base: 'Display value for the day/hour rate.' },
  yearlyGross:{ base: 'Approx annualised gross equivalent of the day/hour rate. Estimate only.' },
  yearlyNet:  { base: 'Approx annualised net equivalent of the day/hour rate, after a rough tax adjustment. Estimate only.' },
  remote_type:{ base: 'Extracted remote signal — "remote", "hybrid", or "on-site". Comes from src/utils/extractors.js.' },
  sectors:    { base: 'Sector tags extracted from the description (pipe-separated).' },
  clearances: { base: 'Security clearance mentioned in the description (e.g. SC, DV, BPSS).' },
  found_at:   { base: 'When the bot first wrote this row to the SQLite jobs table.' },
  tech_tools: { base: 'Tools / software mentioned in the description (Revit, Navisworks, Power BI …). Pipe-separated.' },
  years_experience: { base: 'Years of experience signal extracted from the description, if present.' },
  contract_length_months: { base: 'Contract duration in months, if the source mentioned one.' },
  bonus_percent: { base: 'Discretionary bonus % mentioned in the description.' },
  car_allowance: { base: 'Car / cash-for-car allowance mentioned in the description.' },
  pension_percent:{ base: 'Employer pension contribution % mentioned in the description.' },
  has_equity: { base: 'Whether the description mentions shares / equity / LTIP / stock options.' },
  _actions:   { base: 'Dashboard-only actions: Apply (track that you applied), Not relevant (discard), Expired (role no longer live). Persisted back into SQLite.' },
};

function cellHelpText(col, value) {
  const def = COLUMN_HELP[col.key];
  if (!def) return '';
  let base = def.base || '';
  if (base && col.label) base = base.replace(/\{col\}/g, col.label);
  const specific = def.byValue && value != null && value !== '' ? def.byValue[value] : null;
  if (specific && base) return base + ' For this row: ' + specific;
  return specific || base;
}

const LAYOUT_STORAGE_KEY = 'dashboardLayoutV1';
const TEMPLATE_STORAGE_KEY = 'dashboardTemplatesV1';

const DEFAULT_DIAGRAM_OPTS = { overview: true, advanced: true, pipeline: true, glossary: true };

let layoutState = null;
let lastDashboardData = null;

function normColumnOrder(order) {
  const seen = new Set();
  const out = [];
  for (const k of order || []) {
    if (COL_DEFS_MAP[k] && !seen.has(k)) { seen.add(k); out.push(k); }
  }
  for (const c of COL_DEFS) {
    if (!seen.has(c.key)) out.push(c.key);
  }
  return out;
}

function loadLayoutState() {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        columnOrder: normColumnOrder(p.columnOrder),
        columnWidths: typeof p.columnWidths === 'object' && p.columnWidths ? p.columnWidths : {},
        diagrams: { ...DEFAULT_DIAGRAM_OPTS, ...(p.diagrams || {}) },
      };
    }
  } catch { /* ignore */ }
  return {
    columnOrder: [...DEFAULT_COLUMN_ORDER],
    columnWidths: {},
    diagrams: { ...DEFAULT_DIAGRAM_OPTS },
  };
}

function saveLayoutState() {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layoutState));
  } catch { /* ignore */ }
}

function loadNamedTemplates() {
  try {
    return JSON.parse(localStorage.getItem(TEMPLATE_STORAGE_KEY) || '{}');
  } catch { return {}; }
}

function saveNamedTemplates(obj) {
  try {
    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(obj));
  } catch { /* ignore */ }
}

function getCols() {
  if (!layoutState) layoutState = loadLayoutState();
  const order = layoutState.columnOrder;
  const widths = layoutState.columnWidths || {};
  return order.map(key => {
    const def = COL_DEFS_MAP[key];
    if (!def) return null;
    const w = widths[key] != null ? widths[key] : def.defaultWidth;
    return { ...def, width: Math.max(40, w) + 'px' };
  }).filter(Boolean);
}

