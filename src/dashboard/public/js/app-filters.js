// ─────────────────────────────────────────────────────────────────────────────
// dashboard-app split 3/7 — app-filters.js
// Cross-filter state, section toggles, date utils, table-state vars
// Classic <script> sharing ONE global scope with its siblings. Load order in
// server.js buildDashboardHtml() matters; app-bootstrap.js must load last.
// ─────────────────────────────────────────────────────────────────────────────

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

// Mirror of src/utils/dates.js parseFlexibleDate — this file is served as a
// classic script and can't import ES modules, so the logic is duplicated. Keep
// the two in sync. Understands ISO 8601 plus UK-style DD/MM/YYYY (Reed), and
// never misreads the latter as US MM/DD.
const UK_DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
function parseFlexibleDate(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  const m = s.match(UK_DATE_RE);
  if (m) {
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10) - 1;
    const year = parseInt(m[3], 10);
    const ts = Date.UTC(year, month, day);
    const d = new Date(ts);
    if (d.getUTCFullYear() === year && d.getUTCMonth() === month && d.getUTCDate() === day) return ts;
    return null; // matched shape but invalid calendar date
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/** Sources persist assorted strings in posted_at (ISO, API-native, etc.) — show uniformly as DD/MM/YYYY. */
function formatUkDateDdMmYyyy(raw) {
  const ts = parseFlexibleDate(raw);
  if (ts == null) return raw == null ? '' : String(raw).trim();
  // Render in UTC so a DD/MM/YYYY value (stored at UTC midnight) shows the same
  // calendar day regardless of the viewer's timezone.
  return new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
}

// ── Table state ───────────────────────────────────────────────────────────────
let tableRows  = [];
const DEFAULT_SORT_COL = 'posted_at';
const DEFAULT_SORT_DIR = 'desc';
let sortCol    = DEFAULT_SORT_COL;
let sortDir    = DEFAULT_SORT_DIR;   // 'asc' | 'desc'
let colFilters = {};      // { colKey: string }
let globalQ    = '';

// "Hide jobs posted >2 months ago" — separate from per-run filters so it
// survives a "Clear filters" click. Defaults ON per UX request.
const HIDE_OLD_JOBS_STORAGE_KEY = 'dashboardHideOldJobsV1';
const HIDE_OLD_JOBS_DEFAULT_SEEN_KEY = 'dashboardHideOldJobsDefaultV1Seen';
const OLD_JOB_THRESHOLD_MS = 60 * 24 * 60 * 60 * 1000; // ~2 months (calendar approx)
function loadHideOldJobsPref() {
  try {
    const raw = localStorage.getItem(HIDE_OLD_JOBS_STORAGE_KEY);
    if (raw !== null) return raw === '1' || raw === 'true';
    // First-time visit (or version bump) — force ON and remember we've applied the default
    // so we don't fight a user who explicitly turns it off in the same session.
    const seen = localStorage.getItem(HIDE_OLD_JOBS_DEFAULT_SEEN_KEY);
    if (!seen) {
      localStorage.setItem(HIDE_OLD_JOBS_STORAGE_KEY, '1');
      localStorage.setItem(HIDE_OLD_JOBS_DEFAULT_SEEN_KEY, '1');
    }
    return true;
  } catch { return true; }
}
function saveHideOldJobsPref(on) {
  try { localStorage.setItem(HIDE_OLD_JOBS_STORAGE_KEY, on ? '1' : '0'); } catch { /* ignore */ }
}
let hideOldJobs = loadHideOldJobsPref();

/** True iff row.posted_at parses as a date older than the 2-month threshold. */
function isPostedOlderThan2Months(row, cutoffTs) {
  const t = parseFlexibleDate(row && row.posted_at);
  if (t == null) return false; // never silently hide unknown/unparseable dates
  return t < cutoffTs;
}

