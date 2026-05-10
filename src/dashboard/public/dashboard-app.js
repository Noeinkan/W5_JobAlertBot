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
  filtered_profile:   '#c084fc',
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
    ['Filtered Profile', 'Row removed because CV/profile fit was Red while PROFILE_FIT_ENABLED is on.'],
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
  profile_rating: 'Profile',
  source: 'Source',
  search_name: 'Search',
  salaryBucket: 'Salary band',
  rateType: 'Rate type',
  is_contract: 'Contract',
  jobType: 'Job type',
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
  document.querySelectorAll('.kpi[data-kpi-jobtype]').forEach(el => {
    const v = el.dataset.kpiJobtype;
    const on = crossFilters.jobType && crossFilters.jobType.has(v);
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
  const total     = rows.length;
  const notified  = rows.filter(r => r.outcome === 'new').length;
  const seen      = rows.filter(r => r.outcome === 'already_seen').length;
  const filtered  = rows.filter(r => (r.outcome || '').startsWith('filtered')).length;
  const contract  = rows.filter(r => r.jobType === 'Contract').length;
  const perm      = rows.filter(r => r.jobType === 'Perm').length;
  const applied   = rows.filter(r => r.outcome === 'applied').length;
  const discarded = rows.filter(r => r.outcome === 'discarded').length;
  const expired   = rows.filter(r => r.outcome === 'expired').length;
  if ($('kpiTotal'))     $('kpiTotal').textContent    = total;
  if ($('kpiNotified'))  $('kpiNotified').textContent = notified;
  if ($('kpiSeen'))      $('kpiSeen').textContent     = seen;
  if ($('kpiFiltered'))  $('kpiFiltered').textContent = filtered;
  if ($('kpiContract'))  $('kpiContract').textContent = contract;
  if ($('kpiPerm'))      $('kpiPerm').textContent     = perm;
  if ($('kpiApplied'))   $('kpiApplied').textContent  = applied;
  if ($('kpiDiscarded')) $('kpiDiscarded').textContent = discarded;
  if ($('kpiExpired'))   $('kpiExpired').textContent  = expired;
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
    if (section.classList.contains('section-toggle-none')) return;
    const id = section.dataset.section;
    if (id && id in state) section.classList.toggle('open', !!state[id]);
    if (section.dataset.toggleBound === '1') return;
    const header = section.querySelector('.section-header');
    if (!header) return;
    header.addEventListener('click', () => {
      section.classList.toggle('open');
      const s = loadSectionState();
      s[id] = section.classList.contains('open');
      saveSectionState(s);
      if (section.classList.contains('open'))
        section.dispatchEvent(new CustomEvent('section-opened', { bubbles: false }));
    });
    section.dataset.toggleBound = '1';
  });
}

// ── Table state ───────────────────────────────────────────────────────────────
let tableRows  = [];
const DEFAULT_SORT_COL = 'posted_at';
const DEFAULT_SORT_DIR = 'desc';
let sortCol    = DEFAULT_SORT_COL;
let sortDir    = DEFAULT_SORT_DIR;   // 'asc' | 'desc'
let colFilters = {};      // { colKey: string }
let globalQ    = '';

/** Distinct non-empty values for a column — Excel-style filter source (full dataset, not filtered view). */
function distinctValuesForColumn(key) {
  const set = new Set();
  for (const r of tableRows) {
    const v = r[key];
    if (v != null && v !== '') set.add(String(v));
  }
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * Rebuilds every column filter <select> from current table rows.
 * Initial HTML only runs once; row fields can change in place (e.g. outcome → discarded) so options must stay in sync.
 */
function syncColumnFilterSelectOptions() {
  const card = document.getElementById('tableCard');
  if (!card) return;
  const filterRow = card.querySelector('thead tr.filter-row');
  if (!filterRow) return;
  for (const c of getCols()) {
    if (c.type !== 'select') continue;
    const sel = filterRow.querySelector('select[data-filter="' + c.key + '"]');
    if (!sel) continue;
    const cur = colFilters[c.key] || '';
    let vals = distinctValuesForColumn(c.key);
    if (cur && !vals.includes(cur)) vals = [...vals, cur].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    sel.innerHTML = ['<option value="">All</option>']
      .concat(vals.map(v => '<option value="' + escHtml(v) + '"' + (v === cur ? ' selected' : '') + '>' + escHtml(v) + '</option>'))
      .join('');
  }
}

function getVisible() {
  let rows = rowsPassingCross(tableRows);

  // global search
  if (globalQ) {
    const q = globalQ.toLowerCase();
    const cols = getCols();
    rows = rows.filter(r => cols.some(c => (r[c.key] || '').toLowerCase().includes(q)));
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
      if (sortCol === 'posted_at' || sortCol === 'found_at') {
        const parseTs = v => {
          if (v == null || v === '') return null;
          const t = Date.parse(String(v));
          return Number.isNaN(t) ? null : t;
        };
        const ka = parseTs(a[sortCol]);
        const kb = parseTs(b[sortCol]);
        let cmp;
        if (ka == null && kb == null) cmp = 0;
        else if (ka == null) cmp = 1;
        else if (kb == null) cmp = -1;
        else cmp = ka - kb;
        return sortDir === 'asc' ? cmp : -cmp;
      }
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
  const cols = getCols();
  tbody.innerHTML = visible.map(r => {
    const muted = r.discarded === '1' || r.expired === '1';
    const trOpen = muted ? '<tr class="row-muted">' : '<tr>';
    return trOpen + cols.map(c => {
    const v = r[c.key] ?? '';
    let cell;
    if (c.key === '_actions') {
      const appliedActive = r.applied === '1';
      const discardedActive = r.discarded === '1';
      const expiredActive = r.expired === '1';
      const t  = escHtml(r.title   || '');
      const co = escHtml(r.company || '');
      const s  = escHtml(r.source  || '');
      cell = '<button class="action-btn act-apply' + (appliedActive ? ' active' : '') + '" data-act="applied" data-title="' + t + '" data-company="' + co + '" data-source="' + s + '" title="' + (appliedActive ? 'Undo applied' : 'Mark as applied') + '">'
           + (appliedActive ? '✓ Applied' : 'Apply') + '</button>'
           + '<button class="action-btn act-discard' + (discardedActive ? ' active' : '') + '" data-act="discarded" data-title="' + t + '" data-company="' + co + '" data-source="' + s + '" title="' + (discardedActive ? 'Undo discard' : 'Mark as not relevant') + '">'
           + (discardedActive ? '✗ Discarded' : 'Not relevant') + '</button>'
           + '<button class="action-btn act-expire' + (expiredActive ? ' active' : '') + '" data-act="expired" data-title="' + t + '" data-company="' + co + '" data-source="' + s + '" title="' + (expiredActive ? 'Undo expired' : 'Mark as expired') + '">'
           + (expiredActive ? '⌛ Expired' : 'Expired') + '</button>';
    } else if (c.isLink && v) {
      const t  = escHtml(r.title   || '');
      const co = escHtml(r.company || '');
      const s  = escHtml(r.source  || '');
      const u  = escHtml(v);
      cell = '<span class="link-cell-inner"><a href="' + u + '" target="_blank" rel="noreferrer">open ↗</a>'
        + '<button type="button" class="job-preview-btn" data-title="' + t + '" data-company="' + co + '" data-source="' + s + '" data-url="' + u + '" title="Stored job text with search and RAG highlights">highlights</button></span>';
    } else if (c.isRate && v) {
      const cls = r.rateType === 'day' ? 'rate-day' : 'rate-hour';
      cell = '<span class="badge ' + cls + '">' + escHtml(v) + '</span>';
    } else if (c.isYearly && v) {
      const cls = c.isYearly === 'net' ? 'yearly-net' : 'yearly-gross';
      cell = '<span class="' + cls + '">' + escHtml(v) + '</span>';
    } else if (c.key === 'outcome' && v) {
      cell = '<span class="badge ' + escHtml(v) + '">' + escHtml(v) + '</span>';
    } else if ((c.key === 'rag_rating' || c.key === 'profile_rating') && v) {
      cell = '<span class="badge ' + escHtml(v) + '">' + escHtml(v) + '</span>';
    } else if (c.key === 'is_contract') {
      cell = v === 'yes'
        ? '<span class="badge contract">Contract</span>'
        : '<span class="badge perm">Perm</span>';
    } else {
      cell = escHtml(v);
    }
    return '<td data-key="' + escHtml(c.key) + '"' + (c.wrap ? ' class="wrap"' : '') + ' title="' + escHtml(v) + '" style="width:' + escHtml(c.width) + ';max-width:' + escHtml(c.width) + '">' + cell + '</td>';
  }).join('') + '</tr>';
  }).join('');

  syncColumnFilterSelectOptions();
  syncTableHorizontalScrollWidth();
  applyStickyColumnOffsets();
}

function syncTableHorizontalScrollWidth() {
  const tableWrap = document.getElementById('tableWrap');
  const bottomInner = document.getElementById('bottomScrollInner');
  if (tableWrap && bottomInner) {
    bottomInner.style.width = Math.max(tableWrap.scrollWidth, tableWrap.clientWidth) + 'px';
  }
}

function applyStickyColumnOffsets() {
  const wrap = document.getElementById('tableWrap');
  if (!wrap) return;
  const headerRow = wrap.querySelector('thead tr.header-row');
  const filterRow = wrap.querySelector('thead tr.filter-row');
  if (!headerRow) return;
  wrap.style.setProperty('--dash-header-row-height', headerRow.offsetHeight + 'px');
  wrap.querySelectorAll('thead th.col-sticky, tbody td.col-sticky').forEach(el => {
    el.classList.remove('col-sticky');
    el.style.left = '';
  });
  let left = 0;
  headerRow.querySelectorAll('th[data-key]').forEach(th => {
    const key = th.dataset.key;
    const w = th.offsetWidth;
    if (key === 'url' || key === 'title') {
      th.classList.add('col-sticky');
      th.style.left = left + 'px';
      const filterTh = filterRow && filterRow.querySelector('th[data-key="' + key + '"]');
      if (filterTh) {
        filterTh.classList.add('col-sticky');
        filterTh.style.left = left + 'px';
      }
      wrap.querySelectorAll('tbody td[data-key="' + key + '"]').forEach(td => {
        td.classList.add('col-sticky');
        td.style.left = left + 'px';
      });
    }
    left += w;
  });
}

function buildTableToolbarHTML() {
  const templates = loadNamedTemplates();
  const names = Object.keys(templates).sort();
  const opts = ['<option value="">— Saved templates —</option>']
    .concat(names.map(n => '<option value="' + escHtml(n) + '">' + escHtml(n) + '</option>'))
    .join('');
  const d = (layoutState && layoutState.diagrams) ? layoutState.diagrams : DEFAULT_DIAGRAM_OPTS;
  const ck = (id, prop, label) =>
    '<label class="dash-diag-chk"><input type="checkbox" id="' + id + '" data-diag="' + prop + '"' + (d[prop] ? ' checked' : '') + '/> ' + escHtml(label) + '</label>';
  return '<div class="layout-tools">' +
    '<label for="dashTemplateSelect">Template</label>' +
    '<select id="dashTemplateSelect">' + opts + '</select>' +
    '<button type="button" class="btn" id="dashSaveTemplate" title="Save column order, widths, and diagram visibility">Save as…</button>' +
    '<button type="button" class="btn" id="dashDeleteTemplate" title="Delete selected template">Delete</button>' +
    '<button type="button" class="btn" id="dashResetLayout" title="Restore default column order and widths">Reset columns</button>' +
    '<span class="layout-tools-sep" aria-hidden="true"></span>' +
    '<span class="layout-tools-diag">' +
      ck('dashDiagOverview', 'overview', 'Overview') +
      ck('dashDiagAdvanced', 'advanced', 'Analytics') +
      ck('dashDiagPipeline', 'pipeline', 'Pipeline') +
      ck('dashDiagGlossary', 'glossary', 'Glossary') +
    '</span>' +
    '</div>';
}

function buildTableHTML(rows) {
  const COLS = getCols();
  const opts = {};
  COLS.filter(c => c.type === 'select').forEach(c => {
    opts[c.key] = [...new Set(rows.map(r => r[c.key] != null && r[c.key] !== '' ? String(r[c.key]) : '').filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  });

  const headerCells = COLS.map(c => {
    const w = 'width:' + c.width + ';min-width:' + c.width + ';max-width:' + c.width;
    if (c.type === 'actions') {
      return '<th class="th-col" data-key="' + c.key + '" style="' + w + '"><span class="col-drag" draggable="true" title="Drag to reorder">⠿</span>'
        + escHtml(c.label)
        + '<span class="col-resize" data-resize-key="' + c.key + '" title="Resize column"></span></th>';
    }
    return '<th class="sortable th-col" data-key="' + c.key + '" style="' + w + '">'
      + '<span class="col-drag" draggable="true" title="Drag to reorder">⠿</span>'
      + '<span class="th-label">' + escHtml(c.label) + '</span>'
      + '<i class="sort-icon"></i>'
      + '<span class="col-resize" data-resize-key="' + c.key + '" title="Resize column"></span>'
      + '</th>';
  }).join('');

  const filterCells = COLS.map(c => {
    const wAttr = 'width:' + c.width + ';min-width:' + c.width + ';max-width:' + c.width;
    const w = 'style="' + wAttr + '" data-key="' + escHtml(c.key) + '"';
    if (c.type === 'actions') return '<th ' + w + '></th>';
    if (c.type === 'select') {
      const cur = colFilters[c.key] || '';
      const options = ['<option value="">All</option>']
        .concat(opts[c.key].map(v => '<option value="' + escHtml(v) + '"' + (v === cur ? ' selected' : '') + '>' + escHtml(v) + '</option>'))
        .join('');
      return '<th ' + w + '><select data-filter="' + c.key + '">' + options + '</select></th>';
    }
    return '<th ' + w + '><input type="text" placeholder="filter…" data-filter="' + c.key + '" value="' + escHtml(colFilters[c.key] || '') + '"/></th>';
  }).join('');

  return `
<div class="table-card" id="tableCard">
  <div class="table-toolbar">
    <h2>Raw data</h2>
    <input id="globalSearch" type="text" placeholder="Search all columns…"/>
    <span id="rowCount"></span>
    <button class="btn" id="clearFilters">Clear filters</button>
    ${buildTableToolbarHTML()}
  </div>
  <div class="table-scroll-outer">
    <div class="table-wrap hide-h-scrollbar" id="tableWrap">
      <table>
        <thead>
          <tr class="header-row">${headerCells}</tr>
          <tr class="filter-row">${filterCells}</tr>
        </thead>
        <tbody id="tBody"></tbody>
      </table>
    </div>
    <div class="bottom-scroll-wrap" id="bottomScroll"><div class="bottom-scroll-inner" id="bottomScrollInner"></div></div>
  </div>
</div>`;
}

function reapplySortHeaderClass() {
  document.querySelectorAll('thead tr.header-row th').forEach(h => h.classList.remove('asc', 'desc'));
  if (!sortCol) return;
  const th = document.querySelector('thead tr.header-row th.sortable[data-key="' + sortCol + '"]');
  if (th) th.classList.add(sortDir);
}

function syncDiagramPanelsFromState() {
  if (!layoutState) return;
  const d = layoutState.diagrams;
  const ov = document.getElementById('dashOverviewSection');
  if (ov) ov.classList.toggle('dash-layout-hidden', !d.overview);
  const adv = document.getElementById('dashAdvancedCharts');
  if (adv) adv.classList.toggle('dash-layout-hidden', !d.advanced);
  const pipe = document.getElementById('dashPipelineDiagram');
  if (pipe) pipe.classList.toggle('dash-layout-hidden', !d.pipeline);
  const gl = document.getElementById('dashGlossaryWrap');
  if (gl) gl.classList.toggle('dash-layout-hidden', !d.glossary);
}

function refreshTableChrome() {
  const gs = document.getElementById('globalSearch') ? document.getElementById('globalSearch').value : '';
  globalQ = gs;
  const card = document.getElementById('tableCard');
  if (!card) return;
  card.outerHTML = buildTableHTML(tableRows);
  initTableEvents();
  const g = document.getElementById('globalSearch');
  if (g) g.value = gs;
  renderTable();
  reapplySortHeaderClass();
}

function reorderColumns(fromKey, toKey) {
  if (!layoutState) layoutState = loadLayoutState();
  const o = [...layoutState.columnOrder];
  const fi = o.indexOf(fromKey);
  const ti = o.indexOf(toKey);
  if (fi < 0 || ti < 0 || fi === ti) return;
  o.splice(fi, 1);
  o.splice(ti, 0, fromKey);
  layoutState.columnOrder = normColumnOrder(o);
  saveLayoutState();
  refreshTableChrome();
}

function setColumnWidthDom(key, px) {
  document.querySelectorAll('thead th[data-key="' + key + '"], tbody td[data-key="' + key + '"]').forEach(el => {
    el.style.width = px + 'px';
    el.style.minWidth = px + 'px';
    el.style.maxWidth = px + 'px';
  });
  syncTableHorizontalScrollWidth();
  applyStickyColumnOffsets();
}

function persistColumnWidth(key, px) {
  if (!layoutState) layoutState = loadLayoutState();
  layoutState.columnWidths[key] = px;
  saveLayoutState();
}

function initTableEvents() {
  const card = document.getElementById('tableCard');
  if (!card) return;

  // sort (ignore clicks on drag / resize handles)
  card.addEventListener('click', e => {
    if (e.target.closest('.col-drag') || e.target.closest('.col-resize')) return;
    const th = e.target.closest('thead tr.header-row th.sortable');
    if (!th) return;
    const key = th.dataset.key;
    if (sortCol === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    else { sortCol = key; sortDir = 'asc'; }
    document.querySelectorAll('thead tr.header-row th').forEach(h => h.classList.remove('asc', 'desc'));
    th.classList.add(sortDir);
    page = 1;
    renderTable();
  });

  // per-column filters + global search + clear
  card.addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'globalSearch') {
      globalQ = t.value;
      page = 1;
      renderTable();
      return;
    }
    if (t.dataset.filter && t.tagName !== 'SELECT') {
      colFilters[t.dataset.filter] = t.value;
      page = 1;
      renderTable();
    }
  });

  card.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.filter && t.tagName === 'SELECT') {
      colFilters[t.dataset.filter] = t.value;
      page = 1;
      renderTable();
    }
  });

  const clearBtn = document.getElementById('clearFilters');
  if (clearBtn) clearBtn.addEventListener('click', () => {
    globalQ = ''; sortCol = DEFAULT_SORT_COL; sortDir = DEFAULT_SORT_DIR; colFilters = {};
    const gs = document.getElementById('globalSearch');
    if (gs) gs.value = '';
    card.querySelectorAll('[data-filter]').forEach(el => { el.value = ''; });
    document.querySelectorAll('thead tr.header-row th').forEach(h => h.classList.remove('asc', 'desc'));
    const th = document.querySelector('thead tr.header-row th.sortable[data-key="' + sortCol + '"]');
    if (th) th.classList.add(sortDir);
    renderTable();
  });

  // sync table ↔ bottom scrollbar (single horizontal track; native H-bar hidden on #tableWrap)
  const tableWrap = document.getElementById('tableWrap');
  const bottomScroll = document.getElementById('bottomScroll');
  if (tableWrap && bottomScroll) {
    let syncing = false;
    function syncFrom(source) {
      if (syncing) return;
      syncing = true;
      const x = source.scrollLeft;
      if (tableWrap !== source) tableWrap.scrollLeft = x;
      if (bottomScroll !== source) bottomScroll.scrollLeft = x;
      syncing = false;
    }
    tableWrap.addEventListener('scroll', () => syncFrom(tableWrap));
    bottomScroll.addEventListener('scroll', () => syncFrom(bottomScroll));
  }

  // column drag reorder
  let dragColKey = null;
  card.addEventListener('dragstart', e => {
    const h = e.target.closest('.col-drag');
    if (!h) return;
    const th = h.closest('th');
    dragColKey = th ? th.dataset.key : null;
    if (dragColKey) e.dataTransfer.setData('text/plain', dragColKey);
    e.dataTransfer.effectAllowed = 'move';
  });
  card.addEventListener('dragover', e => {
    const th = e.target.closest('th.th-col');
    if (!th || !dragColKey) return;
    e.preventDefault();
  });
  card.addEventListener('drop', e => {
    const th = e.target.closest('th.th-col');
    if (!th || !dragColKey) return;
    e.preventDefault();
    const toKey = th.dataset.key;
    if (toKey && dragColKey !== toKey) reorderColumns(dragColKey, toKey);
    dragColKey = null;
  });

  // column resize
  card.addEventListener('mousedown', e => {
    const handle = e.target.closest('.col-resize');
    if (!handle) return;
    e.preventDefault();
    e.stopPropagation();
    const key = handle.dataset.resizeKey;
    const th = handle.closest('th');
    if (!key || !th) return;
    const startX = e.clientX;
    const startW = th.getBoundingClientRect().width;
    document.body.classList.add('col-resizing');
    function move(ev) {
      const dx = ev.clientX - startX;
      const nw = Math.round(Math.max(40, startW + dx));
      setColumnWidthDom(key, nw);
    }
    function up(ev) {
      const dx = ev.clientX - startX;
      const nw = Math.round(Math.max(40, startW + dx));
      persistColumnWidth(key, nw);
      document.body.classList.remove('col-resizing');
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });

  // templates + diagram toggles
  const tmplSel = document.getElementById('dashTemplateSelect');
  if (tmplSel) tmplSel.addEventListener('change', () => {
    const name = tmplSel.value;
    if (!name) return;
    const t = loadNamedTemplates()[name];
    if (!t) return;
    layoutState = {
      columnOrder: normColumnOrder(t.columnOrder || []),
      columnWidths: { ...(t.columnWidths || {}) },
      diagrams: { ...DEFAULT_DIAGRAM_OPTS, ...(t.diagrams || {}) },
    };
    saveLayoutState();
    if (lastDashboardData) render(lastDashboardData);
    tmplSel.value = '';
  });

  const saveTmpl = document.getElementById('dashSaveTemplate');
  if (saveTmpl) saveTmpl.addEventListener('click', () => {
    if (!layoutState) layoutState = loadLayoutState();
    const name = prompt('Save layout as template named:');
    if (!name || !String(name).trim()) return;
    const key = String(name).trim();
    const all = loadNamedTemplates();
    all[key] = {
      columnOrder: [...layoutState.columnOrder],
      columnWidths: { ...layoutState.columnWidths },
      diagrams: { ...layoutState.diagrams },
    };
    saveNamedTemplates(all);
    const sel = document.getElementById('dashTemplateSelect');
    if (sel && !Array.from(sel.options).some(o => o.value === key)) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = key;
      sel.appendChild(opt);
    }
  });

  const delTmpl = document.getElementById('dashDeleteTemplate');
  if (delTmpl) delTmpl.addEventListener('click', () => {
    const sel = document.getElementById('dashTemplateSelect');
    const name = sel && sel.value ? sel.value : '';
    if (!name) { alert('Select a template first'); return; }
    if (!confirm('Delete template "' + name + '"?')) return;
    const all = loadNamedTemplates();
    delete all[name];
    saveNamedTemplates(all);
    if (lastDashboardData) render(lastDashboardData);
  });

  const resetL = document.getElementById('dashResetLayout');
  if (resetL) resetL.addEventListener('click', () => {
    layoutState = {
      columnOrder: [...DEFAULT_COLUMN_ORDER],
      columnWidths: {},
      diagrams: { ...DEFAULT_DIAGRAM_OPTS },
    };
    saveLayoutState();
    if (lastDashboardData) render(lastDashboardData);
  });

  document.querySelectorAll('[data-diag]').forEach(cb => {
    cb.addEventListener('change', () => {
      if (!layoutState) layoutState = loadLayoutState();
      layoutState.diagrams[cb.dataset.diag] = cb.checked;
      saveLayoutState();
      syncDiagramPanelsFromState();
    });
  });

  if (!window.__dashTableWinResize) {
    window.__dashTableWinResize = true;
    window.addEventListener('resize', () => {
      syncTableHorizontalScrollWidth();
      applyStickyColumnOffsets();
    });
  }

  // ── Action buttons (Applied / Not relevant) ─────────────────────────────
  document.getElementById('tBody').addEventListener('click', async e => {
    const previewBtn = e.target.closest('.job-preview-btn');
    if (previewBtn) {
      e.preventDefault();
      e.stopPropagation();
      openJobPreview(
        previewBtn.getAttribute('data-title') || '',
        previewBtn.getAttribute('data-company') || '',
        previewBtn.getAttribute('data-source') || '',
        previewBtn.getAttribute('data-url') || ''
      );
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act     = btn.dataset.act;      // 'applied' | 'discarded' | 'expired'
    const title   = btn.dataset.title;
    const company = btn.dataset.company;
    const source  = btn.dataset.source;

    const row = tableRows.find(r => r.title === title && r.company === company && r.source === source);
    if (!row) return;

    const wasApplied   = row.applied   === '1';
    const wasDiscarded = row.discarded === '1';
    const wasExpired   = row.expired   === '1';
    let newApplied   = wasApplied;
    let newDiscarded = wasDiscarded;
    let newExpired   = wasExpired;

    if (act === 'applied') {
      newApplied   = !wasApplied;
      if (newApplied) { newDiscarded = false; newExpired = false; }
    } else if (act === 'discarded') {
      newDiscarded = !wasDiscarded;
      if (newDiscarded) { newApplied = false; newExpired = false; }
    } else {
      newExpired = !wasExpired;
      if (newExpired) { newApplied = false; newDiscarded = false; }
    }

    try {
      const res = await fetchWithDashboardToken(API_BASE + '/api/job-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, company, source, applied: newApplied ? 1 : 0, discarded: newDiscarded ? 1 : 0, expired: newExpired ? 1 : 0 }),
      });
      if (res.status === 401) return;
      if (!res.ok) { console.error('Action failed:', await res.text()); return; }

      row.applied   = newApplied   ? '1' : '0';
      row.discarded = newDiscarded ? '1' : '0';
      row.expired   = newExpired   ? '1' : '0';
      row.outcome   = newDiscarded
        ? 'discarded'
        : newExpired
          ? 'expired'
          : newApplied
            ? 'applied'
            : (row._baseOutcome || 'already_seen');

      renderTable();
      updateKpisFromVisible();
    } catch (err) { console.error(err); }
  });
}

// ── Render full page ──────────────────────────────────────────────────────────
function render(data) {
  destroyCharts();
  layoutState = loadLayoutState();
  lastDashboardData = data;
  tableRows = data.rows || [];
  sortCol = DEFAULT_SORT_COL; sortDir = DEFAULT_SORT_DIR; colFilters = {}; globalQ = ''; page = 1;
  crossFilters = {};
  const analytics = data.analytics || {};
  const sequence = analytics.sequence || { labels: [], fetched: [], notified: [], filtered: [], cumulativeFetched: [], cumulativeNotified: [], cumulativeFiltered: [], control: { mean: 0, ucl: 0, lcl: 0 } };
  const selectedFile = document.getElementById('fileSelect')?.value || 'selected csv';

  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="kpi-row">
      <div class="kpi blue static"                                                                  title="Total rows in this CSV">          <div class="val" id="kpiTotal">${data.total}</div>         <div class="lbl">Total fetched</div></div>
      <div class="kpi green"  data-kpi-outcome="new"           title="Click to filter table by Notified">                                  <div class="val" id="kpiNotified">${data.notified}</div>   <div class="lbl">Notified</div></div>
      <div class="kpi amber"  data-kpi-outcome="already_seen"  title="Click to filter table by Already seen">                              <div class="val" id="kpiSeen">${data.alreadySeen}</div>    <div class="lbl">Already seen</div></div>
      <div class="kpi red"    data-kpi="filtered"              title="Click to filter by any filtered_* outcome">                          <div class="val" id="kpiFiltered">${data.filtered}</div>   <div class="lbl">Filtered</div></div>
      <div class="kpi"        data-kpi-jobtype="Contract"      style="--k:#38bdf8" title="Click to filter table by Contract roles">        <div class="val" id="kpiContract" style="color:#38bdf8">${data.contractCount}</div> <div class="lbl">Contract</div></div>
      <div class="kpi"        data-kpi-jobtype="Perm"          style="--k:#94a3b8" title="Click to filter table by Permanent roles">       <div class="val" id="kpiPerm"     style="color:#94a3b8">${data.permCount}</div>     <div class="lbl">Permanent</div></div>
      <div class="kpi"        data-kpi-outcome="applied"        style="--k:#818cf8" title="Click to filter table by Applied jobs">          <div class="val" id="kpiApplied"   style="color:#818cf8">${data.appliedCount}</div>   <div class="lbl">Applied</div></div>
      <div class="kpi"        data-kpi-outcome="discarded"      style="--k:#475569" title="Click to filter table by Discarded jobs">       <div class="val" id="kpiDiscarded" style="color:#475569">${data.discardedCount}</div> <div class="lbl">Discarded</div></div>
      <div class="kpi"        data-kpi-outcome="expired"        style="--k:#fb7185" title="Click to filter table by Expired jobs">         <div class="val" id="kpiExpired"   style="color:#fb7185">${data.expiredCount}</div>   <div class="lbl">Expired</div></div>
    </div>

    <div id="filterBar" class="filter-bar empty"></div>

    <section class="section open ${layoutState.diagrams.overview ? '' : 'dash-layout-hidden'}" data-section="overview" id="dashOverviewSection">
      <div class="section-header">
        <span class="chev">▶</span>
        <h2>Overview</h2>
        <span class="section-meta">8 visuals · click any slice to cross-filter the table</span>
      </div>
      <div class="section-body">
        <div class="charts-grid">
          <div class="card" data-filter-key="outcome">${cardTitle('Outcome breakdown', 'outcome')}<div class="chart-wrap"><canvas id="cOutcome"></canvas></div></div>
          <div class="card" data-filter-key="jobType">${cardTitle('Perm vs Contract', 'contractSplit')}<div class="chart-wrap"><canvas id="cContract"></canvas></div></div>
          <div class="card" data-filter-key="rag_rating">${cardTitle('RAG rating (rated jobs)', 'rag')}<div class="chart-wrap"><canvas id="cRag"></canvas></div></div>
          <div class="card" data-filter-key="profile_rating">${cardTitle('Profile fit (rated jobs)', 'profileFit')}<div class="chart-wrap"><canvas id="cProfile"></canvas></div></div>
          <div class="card" data-filter-key="source">${cardTitle('Jobs by source', 'source')}<div class="chart-wrap tall"><canvas id="cSource"></canvas></div></div>
          <div class="card" data-filter-key="search_name">${cardTitle('Jobs by search', 'search')}<div class="chart-wrap tall"><canvas id="cSearch"></canvas></div></div>
          <div class="card" data-filter-key="salaryBucket">${cardTitle('Salary range', 'salary')}<div class="chart-wrap"><canvas id="cSalary"></canvas></div></div>
          <div class="card" id="contractCard" data-filter-key="rateType">${cardTitle('Contract rates', 'salary')}<div id="contractStats"></div></div>
        </div>
      </div>
    </section>

    <section class="section" data-section="advanced">
      <div class="section-header">
        <span class="chev">▶</span>
        <h2>Advanced analytics</h2>
        <span class="section-meta">source quality, sequence, SPC, schedule and pipeline docs</span>
      </div>
      <div class="section-body">
        <div class="charts-grid ${layoutState.diagrams.advanced ? '' : 'dash-layout-hidden'}" id="dashAdvancedCharts">
          <div class="card" data-filter-key="source">${cardTitle('Source quality funnel', 'sourceQuality')}<div class="chart-wrap tall"><canvas id="cSourceQuality"></canvas></div></div>
          <div class="card" data-filter-key="source">${cardTitle('Source reliability snapshot', 'reliability')}<div class="chart-wrap"><canvas id="cReliability"></canvas></div></div>
          <div class="card" data-filter-key="search_name">${cardTitle('Search effectiveness heatmap', 'searchHeatmap')}<div class="chart-wrap xtall"><canvas id="cSearchHeat"></canvas></div></div>
          <div class="card" data-filter-key="outcome">${cardTitle('Filter pareto', 'pareto')}<div class="chart-wrap tall"><canvas id="cPareto"></canvas></div></div>
          <div class="card">${cardTitle('Outcomes over sequence', 'outcomesOverTime')}<div class="chart-wrap tall"><canvas id="cOutcomeTime"></canvas></div></div>
          <div class="card">${cardTitle('SPC control view (notified)', 'control')}<div class="chart-wrap"><canvas id="cControl"></canvas></div></div>
          <div class="card">${cardTitle('Run throughput view', 'throughput')}<div class="chart-wrap"><canvas id="cThroughput"></canvas></div></div>
          <div class="card">${cardTitle('Schedule heatmap', 'schedule')}<div class="chart-wrap xtall"><canvas id="cSchedule"></canvas></div></div>
          <div class="card" data-filter-key="outcome">${cardTitle('Relevance vs outcome scatter', 'scatter')}<div class="chart-wrap"><canvas id="cScatter"></canvas></div></div>
        </div>
        <div class="diagram-card ${layoutState.diagrams.pipeline ? '' : 'dash-layout-hidden'}" style="margin-top:.85rem" id="dashPipelineDiagram">
          <div class="diagram-header">
            <span class="diagram-title">Pipeline + data model (selected csv)</span>
            <span class="scope-badge">Scope: ${escHtml(selectedFile)}</span>
          </div>
          <div class="diagram-grid">
            <div class="diagram-box">
              <h2>${cardTitle('How pipeline works', 'pipeline').replace('<h2>','').replace('</h2>','')}</h2>
              <div class="diagram-flow">
                <div class="flow-step">Source adapters</div>
                <div class="flow-step">Normalize fields</div>
                <div class="flow-step">Dedup in SQLite</div>
                <div class="flow-step">Seniority + relevance filters</div>
                <div class="flow-step">Discord notify + CSV row logging</div>
              </div>
            </div>
            <div class="diagram-box">
              <h2>${cardTitle('CSV schema and derived metrics', 'schema').replace('<h2>','').replace('</h2>','')}</h2>
              <div class="schema-row">
                <div class="schema-node">CSV row fields<br/><small>source, search, outcome, rag, salary, posted_at</small></div>
                <div class="schema-join">→</div>
                <div class="schema-node">Derived panels<br/><small>funnel, pareto, heatmaps, control view, scatter</small></div>
              </div>
            </div>
          </div>
        </div>
        <div id="dashGlossaryWrap" class="${layoutState.diagrams.glossary ? '' : 'dash-layout-hidden'}">${renderHelpGlossary()}</div>
      </div>
    </section>

    <section class="section open section-toggle-none" data-section="table">
      <div class="section-header">
        <span class="chev">▶</span>
        <h2>Data table</h2>
        <span class="section-meta" id="tableSectionMeta">always visible · chart slices and chips cross-filter it</span>
      </div>
      <div class="section-body">
        ${buildTableHTML(tableRows)}
      </div>
    </section>
  `;

  // charts
  const outLabels = Object.keys(data.byOutcome);
  mkChart('cOutcome', 'doughnut', outLabels, [{
    data: outLabels.map(l => data.byOutcome[l]),
    backgroundColor: outLabels.map(l => OUTCOME_COLORS[l] || '#6366f1'),
    borderWidth: 2, borderColor: '#1a1d27',
  }], { onPick: ({ label }) => toggleCrossFilter('outcome', label) });

  const contractLabels = ['Perm', 'Contract'];
  const contractCounts = [data.byContract?.Perm || 0, data.byContract?.Contract || 0];
  if (contractCounts[0] || contractCounts[1]) {
    mkChart('cContract', 'doughnut', contractLabels, [{
      data: contractCounts,
      backgroundColor: ['#64748b', '#38bdf8'],
      borderWidth: 2, borderColor: '#1a1d27',
    }], { onPick: ({ label }) => toggleCrossFilter('jobType', label) });
  } else {
    document.getElementById('cContract').closest('.card')
      .insertAdjacentHTML('beforeend', '<p style="color:#64748b;font-size:.82rem;margin-top:.5rem">No rows in this run</p>');
  }

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

  const profileLabels = Object.keys(data.byProfile || {});
  if (profileLabels.length) {
    mkChart('cProfile', 'doughnut', profileLabels, [{
      data: profileLabels.map(l => data.byProfile[l]),
      backgroundColor: profileLabels.map(l => RAG_COLORS[l] || '#94a3b8'),
      borderWidth: 2, borderColor: '#1a1d27',
    }], { onPick: ({ label }) => toggleCrossFilter('profile_rating', label) });
  } else {
    document.getElementById('cProfile').closest('.card')
      .insertAdjacentHTML('beforeend', '<p style="color:#64748b;font-size:.82rem;margin-top:.5rem">No profile-rated jobs in this run</p>');
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
  const heatOutcomes = ['new', 'already_seen', 'filtered_match', 'filtered_seniority', 'filtered_salary', 'filtered_rag', 'filtered_profile'];
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
        return `<div class="cr-row" data-rate-type="${rateType}" style="cursor:pointer" title="Click to filter table by ${rateType} contracts">
          <span class="badge ${badge}">${unit === '/day' ? 'Daily' : 'Hourly'}</span>
          <span class="cr-count">${items.length} role${items.length!==1?'s':''}</span>
          <span class="cr-range">£${Math.min(...raws)}–£${Math.max(...raws)}${unit} · avg £${avgRate}${unit}</span>
          <span class="cr-yearly"><span class="yearly-net">${fmtK(minNet)}–${fmtK(maxNet)} net equiv/yr</span> · avg ${fmtK(avgNet)}</span>
        </div>`;
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

  // KPI clicks — filter table by outcome / jobType
  document.querySelectorAll('.kpi[data-kpi-outcome]').forEach(el => {
    el.addEventListener('click', () => toggleCrossFilter('outcome', el.dataset.kpiOutcome));
  });
  document.querySelectorAll('.kpi[data-kpi-jobtype]').forEach(el => {
    el.addEventListener('click', () => toggleCrossFilter('jobType', el.dataset.kpiJobtype));
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
  reapplySortHeaderClass();
  initHelpTips();
  initSectionToggles();
  renderFilterBar();
  markActiveCards();
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function mergeHighlightSpans(spans) {
  spans.sort((a, b) => a.start - b.start || b.priority - a.priority);
  const chosen = [];
  for (const s of spans) {
    if (chosen.some(c => s.start < c.end && s.end > c.start)) continue;
    chosen.push(s);
  }
  chosen.sort((a, b) => a.start - b.start);
  return chosen;
}

function collectHighlightSpans(text, payload) {
  const spans = [];
  const lowerFull = text.toLowerCase();
  const addTerms = (terms, priority, cls) => {
    const dedup = [...new Set((terms || []).map(t => String(t).trim()).filter(t => t.length >= 2))];
    dedup.sort((a, b) => b.length - a.length);
    for (const term of dedup) {
      const n = term.toLowerCase();
      let i = 0;
      while (i < lowerFull.length) {
        const j = lowerFull.indexOf(n, i);
        if (j === -1) break;
        spans.push({
          start: j,
          end: j + term.length,
          priority,
          className: cls,
        });
        i = j + 1;
      }
    }
  };
  addTerms(payload.search_keywords, 100, 'hl-search');
  const rm = payload.rag_matches || {};
  if (Array.isArray(rm.title)) addTerms(rm.title, 85, 'hl-rag-title');
  if (Array.isArray(rm.domain)) addTerms(rm.domain, 80, 'hl-rag-domain');
  if (Array.isArray(rm.experience)) addTerms(rm.experience, 75, 'hl-rag-exp');
  const pm = payload.profile_matches || {};
  if (Array.isArray(pm.positive)) addTerms(pm.positive, 82, 'hl-profile-pos');
  if (Array.isArray(pm.negative)) addTerms(pm.negative, 77, 'hl-profile-neg');
  if (Array.isArray(pm.titlePositive)) addTerms(pm.titlePositive, 81, 'hl-profile-title-pos');
  if (Array.isArray(pm.titleNegative)) addTerms(pm.titleNegative, 83, 'hl-profile-title');
  addTerms(payload.tech_tools, 55, 'hl-tech');
  addTerms(payload.sectors, 45, 'hl-sector');
  return mergeHighlightSpans(spans);
}

function applyHighlightSpans(text, chosen) {
  let out = '';
  let pos = 0;
  for (const s of chosen) {
    out += escHtml(text.slice(pos, s.start));
    out += '<mark class="' + escHtml(s.className) + '">' + escHtml(text.slice(s.start, s.end)) + '</mark>';
    pos = s.end;
  }
  out += escHtml(text.slice(pos));
  return out;
}

function buildHighlightedDescriptionHtml(text, payload) {
  const raw = String(text || '');
  if (!raw.trim()) return '';
  const spans = collectHighlightSpans(raw, payload);
  const body = applyHighlightSpans(raw, spans);
  return '<div class="job-preview-prose">' + body.replace(/\n/g, '<br/>') + '</div>';
}

/** Structured breakdown: RAG summary + lists of terms (same engine as table Reason column, expanded). */
function buildJobAnalysisHtml(data) {
  const chunks = ['<div class="job-preview-analysis">'];
  chunks.push(
    '<p class="job-preview-analysis-note">'
    + 'Scores use the bot’s <strong>RAG matrix</strong> (weighted keyword patterns on title + description), not an external ML API. '
    + 'Lists below are the signals stored for this row.</p>'
  );

  const rag = data.rag_rating || '';
  const score = data.rag_score;
  if (rag || (score != null && score !== '')) {
    chunks.push('<div class="job-preview-rag-summary">');
    chunks.push('<span class="job-preview-label">RAG</span> ');
    const rk = String(rag || '').trim().toLowerCase();
    const ragClass = rk === 'green' || rk === 'amber' || rk === 'red' ? rk : 'unknown';
    chunks.push('<span class="badge rag-badge rag-badge-' + ragClass + '">' + escHtml(rag || '—') + '</span>');
    if (score != null && score !== '') {
      chunks.push(' <span class="job-preview-score">score ' + escHtml(String(score)) + '</span>');
    }
    chunks.push('</div>');
  }
  if (data.rag_reason) {
    chunks.push(
      '<p class="job-preview-reason-text"><span class="job-preview-label">Reason</span> '
      + escHtml(data.rag_reason)
      + '</p>'
    );
  }

  const pr = data.profile_rating || '';
  const pscore = data.profile_score;
  if (pr || (pscore != null && pscore !== '')) {
    chunks.push('<div class="job-preview-rag-summary">');
    chunks.push('<span class="job-preview-label">Profile fit</span> ');
    const pk = String(pr || '').trim().toLowerCase();
    const pClass = pk === 'green' || pk === 'amber' || pk === 'red' ? pk : 'unknown';
    chunks.push('<span class="badge rag-badge rag-badge-' + pClass + '">' + escHtml(pr || '—') + '</span>');
    if (pscore != null && pscore !== '') {
      chunks.push(' <span class="job-preview-score">score ' + escHtml(String(pscore)) + '</span>');
    }
    chunks.push('</div>');
  }
  if (data.profile_reason) {
    chunks.push(
      '<p class="job-preview-reason-text"><span class="job-preview-label">Profile reason</span> '
      + escHtml(data.profile_reason)
      + '</p>'
    );
  }

  const pmEarly = data.profile_matches || {};
  if (pmEarly.northStar) {
    chunks.push(
      '<p class="job-preview-north-star"><span class="job-preview-label">North star</span> '
      + escHtml(pmEarly.northStar)
      + '</p>'
    );
  }

  const sid = data.search_id || '';
  const sname = data.search_name || '';
  if (sid || sname) {
    chunks.push('<p class="job-preview-search-ref"><span class="job-preview-label">Matched search</span> ');
    chunks.push(escHtml(sname || sid));
    if (sid && sname && sid !== sname) {
      chunks.push(' <code class="job-preview-code">' + escHtml(sid) + '</code>');
    }
    chunks.push('</p>');
  }

  function kwList(list, label, extraClass) {
    if (!list || !list.length) return;
    chunks.push('<div class="job-preview-term-group">');
    chunks.push('<span class="job-preview-label">' + escHtml(label) + '</span>');
    chunks.push('<ul class="job-preview-term-list ' + (extraClass || '') + '">');
    for (const t of list) {
      chunks.push('<li>' + escHtml(t) + '</li>');
    }
    chunks.push('</ul></div>');
  }

  kwList(data.search_keywords, 'Search phrases (from your query config)');
  const rm = data.rag_matches || {};
  kwList(Array.isArray(rm.title) ? rm.title : [], 'RAG · title signals');
  kwList(Array.isArray(rm.domain) ? rm.domain : [], 'RAG · domain signals');
  kwList(Array.isArray(rm.experience) ? rm.experience : [], 'RAG · experience signals');
  const pm = data.profile_matches || {};
  kwList(Array.isArray(pm.positive) ? pm.positive : [], 'Profile · positive signals');
  kwList(Array.isArray(pm.titlePositive) ? pm.titlePositive : [], 'Profile · title positive');
  kwList(Array.isArray(pm.negative) ? pm.negative : [], 'Profile · downrank signals');
  kwList(Array.isArray(pm.titleNegative) ? pm.titleNegative : [], 'Profile · title downrank');
  if (pm.dimensionScores && typeof pm.dimensionScores === 'object') {
    const pairs = Object.entries(pm.dimensionScores).filter(([, v]) => v != null && v !== '');
    if (pairs.length) {
      chunks.push('<div class="job-preview-term-group">');
      chunks.push('<span class="job-preview-label">Profile · dimension scores (capped)</span>');
      chunks.push('<ul class="job-preview-term-list">');
      for (const [dk, dv] of pairs) {
        chunks.push('<li><code>' + escHtml(dk) + '</code>: ' + escHtml(String(dv)) + '</li>');
      }
      chunks.push('</ul></div>');
    }
  }
  kwList(data.tech_tools, 'Extracted tools');
  kwList(data.sectors, 'Extracted sectors');

  const hasRagLists =
    (rm.title && rm.title.length) ||
    (rm.domain && rm.domain.length) ||
    (rm.experience && rm.experience.length);
  if (!hasRagLists && data.rag_matches == null) {
    chunks.push(
      '<p class="job-preview-muted">No per-signal RAG lists in the database for this job — only the summary line above may be available.</p>'
    );
  }

  chunks.push('</div>');
  return chunks.join('');
}

function jobPreviewLegendHtml() {
  return '<span class="hl-key"><mark class="hl-search">Search</mark> <mark class="hl-rag-title">RAG title</mark> <mark class="hl-rag-domain">RAG domain</mark> <mark class="hl-rag-exp">RAG experience</mark> <mark class="hl-profile-pos">Profile +</mark> <mark class="hl-profile-title-pos">Title +</mark> <mark class="hl-profile-neg">Profile −</mark> <mark class="hl-tech">Tools</mark> <mark class="hl-sector">Sectors</mark></span>';
}

function ensureJobPreviewModal() {
  if (document.getElementById('jobPreviewModal')) return;
  const wrap = document.createElement('div');
  wrap.id = 'jobPreviewModal';
  wrap.className = 'job-preview-modal';
  wrap.innerHTML =
    '<div class="job-preview-backdrop" data-close-preview="1"></div>'
    + '<div class="job-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="jobPreviewTitle">'
    + '<button type="button" class="job-preview-close" data-close-preview="1" aria-label="Close">×</button>'
    + '<h3 id="jobPreviewTitle" class="job-preview-heading"></h3>'
    + '<div id="jobPreviewBody" class="job-preview-body"></div>'
    + '<div class="job-preview-footer">'
    + '<a id="jobPreviewExternal" href="#" target="_blank" rel="noreferrer">Open original listing ↗</a>'
    + '</div></div>';
  document.body.appendChild(wrap);
  wrap.addEventListener('click', e => {
    if (e.target.dataset.closePreview != null) wrap.style.display = 'none';
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') wrap.style.display = 'none';
  });
}

async function openJobPreview(title, company, source, fallbackUrl) {
  ensureJobPreviewModal();
  const modal = document.getElementById('jobPreviewModal');
  const bodyEl = document.getElementById('jobPreviewBody');
  const titleEl = document.getElementById('jobPreviewTitle');
  const ext = document.getElementById('jobPreviewExternal');
  titleEl.textContent = title || 'Job';
  ext.href = fallbackUrl || '#';
  bodyEl.innerHTML = '<p class="job-preview-loading">Loading…</p>';
  modal.style.display = 'flex';
  try {
    const q = new URLSearchParams({ title, company: company || '', source });
    const res = await fetchWithDashboardToken(API_BASE + '/api/job-preview?' + q.toString());
    if (!res.ok) {
      let msg = res.statusText;
      try {
        const err = await res.json();
        if (err.error) msg = err.error;
      } catch { /* ignore */ }
      bodyEl.innerHTML = '<p class="job-preview-error">' + escHtml(msg) + '</p>';
      return;
    }
    const data = await res.json();
    if (data.url) ext.href = data.url;
    if (data.title) titleEl.textContent = data.title;
    const analysisHtml = buildJobAnalysisHtml(data);
    const descHtml = buildHighlightedDescriptionHtml(data.description || '', data);
    const legendHtml = '<div class="job-preview-legend-block">' + jobPreviewLegendHtml() + '</div>';
    const proseSection =
      '<h4 class="job-preview-section-title">Description (highlighted)</h4>'
      + (descHtml || '<p class="job-preview-empty">No description stored for this job.</p>');
    bodyEl.innerHTML = analysisHtml + legendHtml + proseSection;
  } catch (e) {
    bodyEl.innerHTML = '<p class="job-preview-error">' + escHtml(e.message) + '</p>';
  }
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
    section.style.display = '';

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
    // resize chart when user opens the collapsed section (canvas was hidden during creation)
    section.addEventListener('section-opened', () => { if (trendChart) trendChart.resize(); }, { once: false });
  } catch { /* silently skip trend chart on errors */ }
}

async function renderProfileFitBanner() {
  const mount = document.getElementById('profileFitMount');
  if (!mount) return;
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  try {
    const res = await fetch(API_BASE + '/api/profile-summary');
    const data = await res.json();
    const enabled = !!data.enabled;
    const badgeClass = enabled ? 'profile-fit-badge profile-fit-badge--on' : 'profile-fit-badge profile-fit-badge--off';
    const badgeText = enabled ? 'Profile fit ON' : 'Profile fit OFF';
    const pathBits = String(data.profilePath || '').replace(/\\/g, '/').split('/').filter(Boolean);
    const pathShort = pathBits.length >= 2 ? pathBits.slice(-2).join('/') : (data.profilePath || '');
    let body = '';
    if (!enabled) {
      body = '<p class="profile-fit-note">CV-aligned scoring is disabled. Set <code>PROFILE_FIT_ENABLED=true</code> in <code>.env</code> (or remove <code>PROFILE_FIT_ENABLED=false</code>) and restart the bot.</p>';
    } else if (data.ok === false && data.error === 'file_missing') {
      body = '<p class="profile-fit-note profile-fit-note--warn">Profile file missing at <code>' + esc(data.profilePath) + '</code>.</p>';
    } else if (data.ok === false) {
      body = '<p class="profile-fit-note profile-fit-note--warn">' + esc(data.error || 'Could not read profile JSON') + '</p>';
    } else if (data.northStar) {
      body = '<p class="profile-fit-north-star"><strong>North star</strong> — ' + esc(data.northStar) + '</p>';
    }
    const ver = data.version != null ? '<span class="profile-fit-meta">schema v' + esc(data.version) + '</span>' : '';
    mount.innerHTML =
      '<section class="profile-fit-strip" aria-label="Profile fit summary">'
      + '<div class="profile-fit-strip-head">'
      + '<span class="' + badgeClass + '">' + badgeText + '</span>'
      + '<span class="profile-fit-title">CV-aligned second score</span>'
      + ver
      + '</div>'
      + '<div class="profile-fit-strip-path" title="' + esc(data.profilePath) + '">' + esc(pathShort || data.profilePath || '') + '</div>'
      + body
      + '<p class="profile-fit-hint">Table columns <strong>Profile</strong> / <strong>Prof score</strong> / <strong>Prof reason</strong> · tune patterns in <code>data/profile.json</code></p>'
      + '</section>';
  } catch (e) {
    mount.innerHTML = '<section class="profile-fit-strip profile-fit-strip--error">Could not load profile summary.</section>';
  }
}

async function init() {
  await renderProfileFitBanner();
  const res = await fetch(API_BASE + '/api/files');
  const files = await res.json();
  const sel = document.getElementById('fileSelect');
  files.forEach((f, i) => {
    const opt = document.createElement('option');
    opt.value = f;
    opt.textContent = f.replace(/^run_/, '').replace(/(_oneshot|_bot)\.csv$/, ' ($1).csv');
    if (i === 0) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => loadFile(sel.value));
  initSectionToggles();
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
  const logSec = document.getElementById('logSection');
  if (logSec) {
    if (running) { logSec.style.display = ''; logSec.classList.add('has-activity'); }
    else         { logSec.classList.remove('has-activity'); }
  }
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
      opt.textContent = f === '__all__.csv'
        ? '★ All jobs (deduped from DB)'
        : f.replace(/^run_/, '').replace(/(_oneshot|_bot)\.csv$/, ' ($1).csv');
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
  const res = await fetchWithDashboardToken(API_BASE + '/api/bot/' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok && res.status !== 401) alert(await res.text());
}

function showLogSection() {
  const sec = document.getElementById('logSection');
  if (sec) {
    sec.style.display = '';
    sec.classList.add('has-activity');
  }
}

runOnceBtn.addEventListener('click', () => {
  logPanel.textContent = '';
  showLogSection();
  needsRefresh = true;
  botAction('start-once');
});

startBotBtn.addEventListener('click', () => {
  logPanel.textContent = '';
  showLogSection();
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