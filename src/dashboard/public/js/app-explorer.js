// ─────────────────────────────────────────────────────────────────────────────
// dashboard-app split 6/7 — app-explorer.js
// Fullscreen chart explorer (fs*, FS_REGISTRY)
// Classic <script> sharing ONE global scope with its siblings. Load order in
// server.js buildDashboardHtml() matters; app-bootstrap.js must load last.
// ─────────────────────────────────────────────────────────────────────────────

// ── Chart fullscreen + per-chart filter panel ────────────────────────────────
//
// Each chart card has a ⤢ button (added by cardTitle) which opens a large modal
// that renders the same chart on a bigger canvas plus a filter panel sidebar.
// Filters mutate fsState.filters and re-render only the fullscreen canvas; they
// never touch the dashboard's main charts or the cross-filter table chips.

const FS_OUTCOME_HEAT_KEYS = [
  'new', 'already_seen', 'filtered_match', 'filtered_seniority',
  'filtered_salary', 'filtered_rag', 'filtered_profile', 'filtered_profile_strict',
];

let fsCharts = [];
let fsState = { chartId: null, filters: {} };

function fsDestroyCharts() {
  fsCharts.forEach(c => { try { c.destroy(); } catch { /* ignore */ } });
  fsCharts = [];
}

function fsMkChart(canvasId, type, labels, datasets, extra = {}) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  const opts = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: { legend: { labels: { color: '#cbd5e1', boxWidth: 14, font: { size: 12 } } } },
    scales: (type === 'bar') ? {
      x: { ticks: { color: '#cbd5e1', font: { size: 12 } }, grid: { color: '#1e2235' } },
      y: { ticks: { color: '#cbd5e1', font: { size: 12 } }, grid: { color: '#1e2235' } },
    } : {},
    ...extra,
  };
  const ch = new Chart(ctx, { type, data: { labels, datasets }, options: opts });
  fsCharts.push(ch);
  return ch;
}

function fsSelected(state, key, allOptions) {
  const cur = state[key];
  if (!Array.isArray(cur)) return [...allOptions];
  return cur.filter(v => allOptions.includes(v));
}

function fsApplySortAndTopN(entries, sortBy, topN) {
  const out = [...entries];
  if (sortBy === 'name_asc') out.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  else if (sortBy === 'name_desc') out.sort((a, b) => String(b[0]).localeCompare(String(a[0])));
  else if (sortBy === 'count_asc') out.sort((a, b) => (Number(a[1]) || 0) - (Number(b[1]) || 0));
  else out.sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0));
  if (topN > 0) return out.slice(0, topN);
  return out;
}

// ── Per-chart fullscreen renderers ──
// Each renderer reads `lastDashboardData` + filter state, builds the chart on
// the fullscreen canvas. They mirror the small-card chart configs but with
// extra filtering.

function fsRenderOutcome(canvasId, fs) {
  const data = lastDashboardData || {};
  const all = Object.keys(data.byOutcome || {});
  const sel = fsSelected(fs, 'outcomes', all);
  const labels = all.filter(l => sel.includes(l));
  fsMkChart(canvasId, 'doughnut', labels, [{
    data: labels.map(l => data.byOutcome[l]),
    backgroundColor: labels.map(l => OUTCOME_COLORS[l] || '#6366f1'),
    borderWidth: 2, borderColor: '#0f1117',
  }], { plugins: { legend: { position: 'right', labels: { color: '#cbd5e1', font: { size: 12 } } } } });
}

function fsRenderContract(canvasId) {
  const data = lastDashboardData || {};
  const counts = [data.byContract?.Perm || 0, data.byContract?.Contract || 0];
  fsMkChart(canvasId, 'doughnut', ['Perm', 'Contract'], [{
    data: counts,
    backgroundColor: ['#64748b', '#38bdf8'],
    borderWidth: 2, borderColor: '#0f1117',
  }], { plugins: { legend: { position: 'right', labels: { color: '#cbd5e1', font: { size: 12 } } } } });
}

function fsRenderRag(canvasId, fs) {
  const data = lastDashboardData || {};
  const all = Object.keys(data.byRag || {});
  const sel = fsSelected(fs, 'ratings', all);
  const labels = all.filter(l => sel.includes(l));
  fsMkChart(canvasId, 'doughnut', labels, [{
    data: labels.map(l => data.byRag[l]),
    backgroundColor: labels.map(l => RAG_COLORS[l] || '#94a3b8'),
    borderWidth: 2, borderColor: '#0f1117',
  }], { plugins: { legend: { position: 'right', labels: { color: '#cbd5e1', font: { size: 12 } } } } });
}

function fsRenderProfile(canvasId, fs) {
  const data = lastDashboardData || {};
  const all = Object.keys(data.byProfile || {});
  const sel = fsSelected(fs, 'ratings', all);
  const labels = all.filter(l => sel.includes(l));
  fsMkChart(canvasId, 'doughnut', labels, [{
    data: labels.map(l => data.byProfile[l]),
    backgroundColor: labels.map(l => RAG_COLORS[l] || '#94a3b8'),
    borderWidth: 2, borderColor: '#0f1117',
  }], { plugins: { legend: { position: 'right', labels: { color: '#cbd5e1', font: { size: 12 } } } } });
}

function fsRenderSource(canvasId, fs) {
  const data = lastDashboardData || {};
  const all = Object.keys(data.bySource || {});
  const sel = fsSelected(fs, 'sources', all);
  let entries = Object.entries(data.bySource || {}).filter(([k]) => sel.includes(k));
  entries = fsApplySortAndTopN(entries, fs.sortBy || 'count_desc', Number(fs.topN) || 0);
  const labels = entries.map(e => e[0]);
  fsMkChart(canvasId, 'bar', labels, [{
    label: 'Jobs', data: entries.map(e => e[1]),
    backgroundColor: PALETTE.slice(0, labels.length), borderRadius: 4,
  }], { plugins: { legend: { display: false } } });
}

function fsRenderSearch(canvasId, fs) {
  const data = lastDashboardData || {};
  const all = Object.keys(data.bySearch || {});
  const sel = fsSelected(fs, 'searches', all);
  let entries = Object.entries(data.bySearch || {}).filter(([k]) => sel.includes(k));
  entries = fsApplySortAndTopN(entries, fs.sortBy || 'count_desc', Number(fs.topN) || 0);
  const labels = entries.map(e => e[0]);
  fsMkChart(canvasId, 'bar', labels, [{
    label: 'Jobs', data: entries.map(e => e[1]),
    backgroundColor: PALETTE.slice(0, labels.length), borderRadius: 4,
  }], {
    indexAxis: 'y',
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: '#cbd5e1', font: { size: 12 } }, grid: { color: '#1e2235' } },
      y: { ticks: { color: '#cbd5e1', font: { size: 11 } }, grid: { color: '#1e2235' } },
    },
  });
}

function fsRenderSalary(canvasId, fs) {
  const data = lastDashboardData || {};
  const all = Object.keys(data.salaryBuckets || {});
  const sel = fsSelected(fs, 'buckets', all);
  const labels = all.filter(l => sel.includes(l));
  fsMkChart(canvasId, 'bar', labels, [{
    label: 'Jobs', data: labels.map(l => data.salaryBuckets[l]),
    backgroundColor: '#6366f1', borderRadius: 4,
  }], { plugins: { legend: { display: false } } });
}

function fsRenderSourceQuality(canvasId, fs) {
  const data = lastDashboardData || {};
  const sq = (data.analytics?.sourceQuality || []);
  const all = sq.map(s => s.source);
  const sel = fsSelected(fs, 'sources', all);
  let rows = sq.filter(s => sel.includes(s.source));
  const sortBy = fs.sortBy || 'fetched_desc';
  if (sortBy === 'name_asc') rows.sort((a, b) => a.source.localeCompare(b.source));
  else if (sortBy === 'name_desc') rows.sort((a, b) => b.source.localeCompare(a.source));
  else if (sortBy === 'notified_desc') rows.sort((a, b) => (b.notified || 0) - (a.notified || 0));
  else rows.sort((a, b) => (b.fetched || 0) - (a.fetched || 0));
  const topN = Number(fs.topN) || 0;
  if (topN > 0) rows = rows.slice(0, topN);
  const series = fs.series || { fetched: true, passed: true, notified: true };
  const datasets = [];
  if (series.fetched) datasets.push({ label: 'Fetched', data: rows.map(r => r.fetched), backgroundColor: '#334155' });
  if (series.passed)  datasets.push({ label: 'Passed', data: rows.map(r => r.passed), backgroundColor: '#22d3ee' });
  if (series.notified) datasets.push({ label: 'Notified', data: rows.map(r => r.notified), backgroundColor: '#4ade80' });
  fsMkChart(canvasId, 'bar', rows.map(r => r.source), datasets, {
    scales: {
      x: { stacked: true, ticks: { color: '#cbd5e1', font: { size: 11 }, autoSkip: false }, grid: { color: '#1e2235' } },
      y: { stacked: true, ticks: { color: '#cbd5e1' }, grid: { color: '#1e2235' } },
    },
  });
}

function fsRenderReliability(canvasId, fs) {
  const data = lastDashboardData || {};
  const sq = (data.analytics?.sourceQuality || []);
  const all = sq.map(s => s.source);
  const sel = fsSelected(fs, 'sources', all);
  let rows = sq.filter(s => sel.includes(s.source));
  const minR = Number(fs.minReliability) || 0;
  if (minR > 0) rows = rows.filter(r => (r.reliability || 0) >= minR);
  const sortBy = fs.sortBy || 'reliability_desc';
  if (sortBy === 'reliability_asc') rows.sort((a, b) => (a.reliability || 0) - (b.reliability || 0));
  else if (sortBy === 'name_asc') rows.sort((a, b) => a.source.localeCompare(b.source));
  else rows.sort((a, b) => (b.reliability || 0) - (a.reliability || 0));
  fsMkChart(canvasId, 'bar', rows.map(r => r.source), [{
    label: 'Reliability %', data: rows.map(r => r.reliability),
    backgroundColor: rows.map(r => colorFromPercent(r.reliability)),
  }], {
    plugins: { legend: { display: false } },
    scales: {
      y: { min: 0, max: 100, ticks: { color: '#cbd5e1', callback: v => v + '%' }, grid: { color: '#1e2235' } },
      x: { ticks: { color: '#cbd5e1' }, grid: { color: '#1e2235' } },
    },
  });
}

function fsRenderSearchHeat(canvasId, fs) {
  const data = lastDashboardData || {};
  let searchEff = data.analytics?.searchEffectiveness || [];
  const allSearches = searchEff.map(s => s.search);
  const selSearches = fsSelected(fs, 'searches', allSearches);
  searchEff = searchEff.filter(s => selSearches.includes(s.search));
  const topN = Number(fs.topN) || 0;
  if (topN > 0) searchEff = searchEff.slice(0, topN);
  const allOutcomes = FS_OUTCOME_HEAT_KEYS;
  const selOutcomes = fsSelected(fs, 'outcomes', allOutcomes);
  const heatData = [];
  searchEff.forEach((s, yi) => {
    selOutcomes.forEach((o) => {
      const xi = allOutcomes.indexOf(o);
      const pct = ((s.byOutcome[o] || 0) / Math.max(1, s.total)) * 100;
      heatData.push({ x: xi, y: yi, r: 10, pct, label: s.search, outcome: o });
    });
  });
  fsMkChart(canvasId, 'bubble', [], [{
    label: 'Outcome %', data: heatData,
    backgroundColor: heatData.map(p => colorFromPercent(p.pct)),
  }], {
    parsing: false,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: ctx => ctx.raw.label + ' · ' + ctx.raw.outcome + ': ' + ctx.raw.pct.toFixed(1) + '%' } },
    },
    scales: {
      x: { type: 'linear', min: -0.5, max: allOutcomes.length - 0.5, ticks: { stepSize: 1, color: '#cbd5e1', callback: v => allOutcomes[v] || '' }, grid: { color: '#1e2235' } },
      y: { type: 'linear', min: -0.5, max: Math.max(0, searchEff.length - 0.5), ticks: { stepSize: 1, color: '#cbd5e1', callback: v => (searchEff[v]?.search || '').slice(0, 22) }, grid: { color: '#1e2235' } },
    },
  });
}

function fsRenderPareto(canvasId, fs) {
  const data = lastDashboardData || {};
  let pareto = data.analytics?.pareto || [];
  const topN = Number(fs.topN) || 0;
  if (topN > 0) pareto = pareto.slice(0, topN);
  // Recalculate cumulative pct on truncated slice for accuracy on subset
  const total = pareto.reduce((a, p) => a + (p.value || 0), 0);
  let acc = 0;
  const cumPct = pareto.map(p => {
    acc += (p.value || 0);
    return total > 0 ? Math.round((acc / total) * 1000) / 10 : 0;
  });
  fsMkChart(canvasId, 'bar', pareto.map(p => p.label.replace('filtered_', '')), [
    { label: 'Count', data: pareto.map(p => p.value), backgroundColor: '#f59e0b', yAxisID: 'y' },
    { label: 'Cumulative %', data: cumPct, type: 'line', borderColor: '#a78bfa', backgroundColor: '#a78bfa', yAxisID: 'y1', tension: .2 },
  ], {
    scales: {
      y: { ticks: { color: '#cbd5e1' }, grid: { color: '#1e2235' } },
      y1: { position: 'right', min: 0, max: 100, ticks: { color: '#a78bfa', callback: v => v + '%' }, grid: { drawOnChartArea: false } },
      x: { ticks: { color: '#cbd5e1' }, grid: { color: '#1e2235' } },
    },
  });
}

function fsSliceSequence(seq, range) {
  const labels = seq.labels || [];
  const start = Math.max(0, Math.min(labels.length - 1, Number(range?.[0]) || 0));
  const end = Math.max(start, Math.min(labels.length - 1, Number(range?.[1] != null ? range[1] : labels.length - 1)));
  const slice = arr => Array.isArray(arr) ? arr.slice(start, end + 1) : [];
  return {
    labels: slice(labels),
    fetched: slice(seq.fetched),
    notified: slice(seq.notified),
    filtered: slice(seq.filtered),
    cumulativeFetched: slice(seq.cumulativeFetched),
    cumulativeNotified: slice(seq.cumulativeNotified),
    cumulativeFiltered: slice(seq.cumulativeFiltered),
    control: seq.control || { mean: 0, ucl: 0, lcl: 0 },
  };
}

function fsRenderOutcomeTime(canvasId, fs) {
  const data = lastDashboardData || {};
  const seq = fsSliceSequence(data.analytics?.sequence || {}, fs.range);
  const series = fs.series || { notified: true, filtered: true, fetched: true };
  const datasets = [];
  if (series.notified) datasets.push({ label: 'Notified', data: seq.notified, backgroundColor: '#4ade80' });
  if (series.filtered) datasets.push({ label: 'Filtered', data: seq.filtered, backgroundColor: '#f87171' });
  if (series.fetched)  datasets.push({ label: 'Fetched',  data: seq.fetched,  backgroundColor: '#60a5fa' });
  fsMkChart(canvasId, 'bar', seq.labels, datasets, {
    scales: {
      x: { stacked: true, ticks: { color: '#cbd5e1', maxRotation: 0, autoSkip: true, maxTicksLimit: 12 }, grid: { color: '#1e2235' } },
      y: { stacked: true, ticks: { color: '#cbd5e1' }, grid: { color: '#1e2235' } },
    },
  });
}

function fsRenderControl(canvasId, fs) {
  const data = lastDashboardData || {};
  const seq = fsSliceSequence(data.analytics?.sequence || {}, fs.range);
  const overlays = fs.overlays || { mean: true, ucl: true, lcl: true };
  const datasets = [
    { label: 'Notified', data: seq.notified, borderColor: '#4ade80', backgroundColor: '#4ade80', tension: .25 },
  ];
  if (overlays.mean) datasets.push({ label: 'Mean', data: seq.labels.map(() => seq.control.mean), borderColor: '#94a3b8', borderDash: [6, 4], pointRadius: 0 });
  if (overlays.ucl)  datasets.push({ label: 'UCL',  data: seq.labels.map(() => seq.control.ucl),  borderColor: '#f59e0b', borderDash: [4, 4], pointRadius: 0 });
  if (overlays.lcl)  datasets.push({ label: 'LCL',  data: seq.labels.map(() => seq.control.lcl),  borderColor: '#fb7185', borderDash: [4, 4], pointRadius: 0 });
  fsMkChart(canvasId, 'line', seq.labels, datasets, {
    scales: {
      x: { ticks: { color: '#cbd5e1', maxRotation: 0, autoSkip: true, maxTicksLimit: 12 }, grid: { color: '#1e2235' } },
      y: { ticks: { color: '#cbd5e1' }, grid: { color: '#1e2235' } },
    },
  });
}

function fsRenderThroughput(canvasId, fs) {
  const data = lastDashboardData || {};
  const seq = fsSliceSequence(data.analytics?.sequence || {}, fs.range);
  const series = fs.series || { fetched: true, notified: true, filtered: true };
  const datasets = [];
  if (series.fetched)  datasets.push({ label: 'Fetched cumulative', data: seq.cumulativeFetched,  borderColor: '#60a5fa', backgroundColor: '#60a5fa', tension: .2 });
  if (series.notified) datasets.push({ label: 'Notified cumulative', data: seq.cumulativeNotified, borderColor: '#4ade80', backgroundColor: '#4ade80', tension: .2 });
  if (series.filtered) datasets.push({ label: 'Filtered cumulative', data: seq.cumulativeFiltered, borderColor: '#f87171', backgroundColor: '#f87171', tension: .2 });
  fsMkChart(canvasId, 'line', seq.labels, datasets, {
    scales: {
      x: { ticks: { color: '#cbd5e1', maxRotation: 0, autoSkip: true, maxTicksLimit: 12 }, grid: { color: '#1e2235' } },
      y: { ticks: { color: '#cbd5e1' }, grid: { color: '#1e2235' } },
    },
  });
}

function fsRenderSchedule(canvasId, fs) {
  const data = lastDashboardData || {};
  const matrix = data.analytics?.schedule || [];
  const dayOpts = DOW_LABELS;
  const selDays = fsSelected(fs, 'days', dayOpts);
  const hourMin = Math.max(0, Math.min(23, Number(fs.hourRange?.[0] ?? 0)));
  const hourMax = Math.max(hourMin, Math.min(23, Number(fs.hourRange?.[1] ?? 23)));
  const points = [];
  for (let d = 0; d < 7; d++) {
    if (!selDays.includes(DOW_LABELS[d])) continue;
    for (let h = hourMin; h <= hourMax; h++) {
      const cnt = matrix[d]?.[h] || 0;
      if (!cnt) continue;
      points.push({ x: h, y: d, r: Math.min(14, 5 + cnt), cnt });
    }
  }
  fsMkChart(canvasId, 'bubble', [], [{
    label: 'Jobs', data: points,
    backgroundColor: points.map(p => colorFromPercent(Math.min(100, p.cnt * 15))),
  }], {
    parsing: false,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: ctx => DOW_LABELS[ctx.raw.y] + ' ' + String(ctx.raw.x).padStart(2, '0') + ':00 · ' + ctx.raw.cnt + ' jobs' } },
    },
    scales: {
      x: { type: 'linear', min: hourMin - 0.5, max: hourMax + 0.5, ticks: { color: '#cbd5e1', stepSize: 2 }, grid: { color: '#1e2235' } },
      y: { type: 'linear', min: -0.5, max: 6.5, ticks: { color: '#cbd5e1', stepSize: 1, callback: v => DOW_LABELS[v] || '' }, grid: { color: '#1e2235' } },
    },
  });
}

function fsRenderScatter(canvasId, fs) {
  const data = lastDashboardData || {};
  const allOutcomes = [...new Set((data.analytics?.ragScatter || []).map(p => p.outcome).filter(Boolean))];
  const sel = fsSelected(fs, 'outcomes', allOutcomes);
  const sMin = Number(fs.scoreMin);
  const sMax = Number(fs.scoreMax);
  let pts = data.analytics?.ragScatter || [];
  if (sel.length !== allOutcomes.length) pts = pts.filter(p => sel.includes(p.outcome));
  if (Number.isFinite(sMin)) pts = pts.filter(p => Number(p.y) >= sMin);
  if (Number.isFinite(sMax)) pts = pts.filter(p => Number(p.y) <= sMax);
  fsMkChart(canvasId, 'scatter', [], [{
    label: 'RAG score', data: pts, parsing: false,
    backgroundColor: pts.map(p => OUTCOME_COLORS[p.outcome] || '#94a3b8'),
    pointRadius: 5,
  }], {
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: ctx => 'Row ' + ctx.raw.x + ' · score ' + ctx.raw.y + ' · ' + (ctx.raw.outcome || 'unknown') } },
    },
    scales: {
      x: { type: 'linear', ticks: { color: '#cbd5e1' }, title: { display: true, text: 'Row order', color: '#94a3b8' }, grid: { color: '#1e2235' } },
      y: { type: 'linear', ticks: { color: '#cbd5e1' }, title: { display: true, text: 'RAG score', color: '#94a3b8' }, grid: { color: '#1e2235' } },
    },
  });
}

// Filter widget definitions per chart. Each widget is rendered into the
// fullscreen filter panel; mutating it re-runs the chart's renderer.
const FS_REGISTRY = {
  cOutcome: {
    title: 'Outcome breakdown',
    helpKey: 'outcome',
    render: fsRenderOutcome,
    spec: () => {
      const opts = Object.keys(lastDashboardData?.byOutcome || {});
      return [{ type: 'multiselect', key: 'outcomes', label: 'Outcomes', options: opts }];
    },
    defaults: () => ({ outcomes: Object.keys(lastDashboardData?.byOutcome || {}) }),
  },
  cContract: {
    title: 'Perm vs Contract',
    helpKey: 'contractSplit',
    render: fsRenderContract,
    spec: () => [],
    defaults: () => ({}),
  },
  cRag: {
    title: 'RAG rating (rated jobs)',
    helpKey: 'rag',
    render: fsRenderRag,
    spec: () => {
      const opts = Object.keys(lastDashboardData?.byRag || {});
      return [{ type: 'multiselect', key: 'ratings', label: 'Ratings', options: opts }];
    },
    defaults: () => ({ ratings: Object.keys(lastDashboardData?.byRag || {}) }),
  },
  cProfile: {
    title: 'Profile fit (rated jobs)',
    helpKey: 'profileFit',
    render: fsRenderProfile,
    spec: () => {
      const opts = Object.keys(lastDashboardData?.byProfile || {});
      return [{ type: 'multiselect', key: 'ratings', label: 'Ratings', options: opts }];
    },
    defaults: () => ({ ratings: Object.keys(lastDashboardData?.byProfile || {}) }),
  },
  cSource: {
    title: 'Jobs by source',
    helpKey: 'source',
    render: fsRenderSource,
    spec: () => [
      { type: 'multiselect', key: 'sources', label: 'Sources', options: Object.keys(lastDashboardData?.bySource || {}) },
      { type: 'sort', key: 'sortBy', label: 'Sort by', options: [
        { value: 'count_desc', label: 'Count (high→low)' },
        { value: 'count_asc',  label: 'Count (low→high)' },
        { value: 'name_asc',   label: 'Name (A→Z)' },
        { value: 'name_desc',  label: 'Name (Z→A)' },
      ] },
      { type: 'topN', key: 'topN', label: 'Show top N', max: 30 },
    ],
    defaults: () => ({ sources: Object.keys(lastDashboardData?.bySource || {}), sortBy: 'count_desc', topN: 0 }),
  },
  cSearch: {
    title: 'Jobs by search',
    helpKey: 'search',
    render: fsRenderSearch,
    spec: () => [
      { type: 'multiselect', key: 'searches', label: 'Searches', options: Object.keys(lastDashboardData?.bySearch || {}) },
      { type: 'sort', key: 'sortBy', label: 'Sort by', options: [
        { value: 'count_desc', label: 'Count (high→low)' },
        { value: 'count_asc',  label: 'Count (low→high)' },
        { value: 'name_asc',   label: 'Name (A→Z)' },
        { value: 'name_desc',  label: 'Name (Z→A)' },
      ] },
      { type: 'topN', key: 'topN', label: 'Show top N', max: 30 },
    ],
    defaults: () => ({ searches: Object.keys(lastDashboardData?.bySearch || {}), sortBy: 'count_desc', topN: 0 }),
  },
  cSalary: {
    title: 'Salary range',
    helpKey: 'salary',
    render: fsRenderSalary,
    spec: () => [
      { type: 'multiselect', key: 'buckets', label: 'Salary bands', options: Object.keys(lastDashboardData?.salaryBuckets || {}) },
    ],
    defaults: () => ({ buckets: Object.keys(lastDashboardData?.salaryBuckets || {}) }),
  },
  cSourceQuality: {
    title: 'Source quality funnel',
    helpKey: 'sourceQuality',
    render: fsRenderSourceQuality,
    spec: () => [
      { type: 'multiselect', key: 'sources', label: 'Sources', options: (lastDashboardData?.analytics?.sourceQuality || []).map(s => s.source) },
      { type: 'sort', key: 'sortBy', label: 'Sort by', options: [
        { value: 'fetched_desc',  label: 'Fetched (high→low)' },
        { value: 'notified_desc', label: 'Notified (high→low)' },
        { value: 'name_asc',      label: 'Name (A→Z)' },
        { value: 'name_desc',     label: 'Name (Z→A)' },
      ] },
      { type: 'topN', key: 'topN', label: 'Show top N', max: 30 },
      { type: 'toggle', key: 'series', label: 'Series', items: [
        { key: 'fetched', label: 'Fetched' },
        { key: 'passed',  label: 'Passed' },
        { key: 'notified', label: 'Notified' },
      ] },
    ],
    defaults: () => ({
      sources: (lastDashboardData?.analytics?.sourceQuality || []).map(s => s.source),
      sortBy: 'fetched_desc', topN: 0,
      series: { fetched: true, passed: true, notified: true },
    }),
  },
  cReliability: {
    title: 'Source reliability snapshot',
    helpKey: 'reliability',
    render: fsRenderReliability,
    spec: () => [
      { type: 'multiselect', key: 'sources', label: 'Sources', options: (lastDashboardData?.analytics?.sourceQuality || []).map(s => s.source) },
      { type: 'sort', key: 'sortBy', label: 'Sort by', options: [
        { value: 'reliability_desc', label: 'Reliability (high→low)' },
        { value: 'reliability_asc',  label: 'Reliability (low→high)' },
        { value: 'name_asc',         label: 'Name (A→Z)' },
      ] },
      { type: 'rangeSlider', key: 'minReliability', label: 'Minimum reliability %', min: 0, max: 100, step: 5 },
    ],
    defaults: () => ({
      sources: (lastDashboardData?.analytics?.sourceQuality || []).map(s => s.source),
      sortBy: 'reliability_desc',
      minReliability: 0,
    }),
  },
  cSearchHeat: {
    title: 'Search effectiveness heatmap',
    helpKey: 'searchHeatmap',
    render: fsRenderSearchHeat,
    spec: () => [
      { type: 'multiselect', key: 'searches', label: 'Searches', options: (lastDashboardData?.analytics?.searchEffectiveness || []).map(s => s.search) },
      { type: 'multiselect', key: 'outcomes', label: 'Outcomes', options: FS_OUTCOME_HEAT_KEYS },
      { type: 'topN', key: 'topN', label: 'Top N searches', max: 30 },
    ],
    defaults: () => ({
      searches: (lastDashboardData?.analytics?.searchEffectiveness || []).map(s => s.search),
      outcomes: [...FS_OUTCOME_HEAT_KEYS],
      topN: 14,
    }),
  },
  cPareto: {
    title: 'Filter pareto',
    helpKey: 'pareto',
    render: fsRenderPareto,
    spec: () => [
      { type: 'topN', key: 'topN', label: 'Top N filter reasons', max: 20 },
    ],
    defaults: () => ({ topN: 0 }),
  },
  cOutcomeTime: {
    title: 'Outcomes over sequence',
    helpKey: 'outcomesOverTime',
    render: fsRenderOutcomeTime,
    spec: () => {
      const len = (lastDashboardData?.analytics?.sequence?.labels || []).length;
      return [
        { type: 'sequenceRange', key: 'range', label: 'Sequence range', max: Math.max(0, len - 1) },
        { type: 'toggle', key: 'series', label: 'Series', items: [
          { key: 'notified', label: 'Notified' },
          { key: 'filtered', label: 'Filtered' },
          { key: 'fetched',  label: 'Fetched' },
        ] },
      ];
    },
    defaults: () => {
      const len = (lastDashboardData?.analytics?.sequence?.labels || []).length;
      return { range: [0, Math.max(0, len - 1)], series: { notified: true, filtered: true, fetched: true } };
    },
  },
  cControl: {
    title: 'SPC control view (notified)',
    helpKey: 'control',
    render: fsRenderControl,
    spec: () => {
      const len = (lastDashboardData?.analytics?.sequence?.labels || []).length;
      return [
        { type: 'sequenceRange', key: 'range', label: 'Sequence range', max: Math.max(0, len - 1) },
        { type: 'toggle', key: 'overlays', label: 'Overlays', items: [
          { key: 'mean', label: 'Mean' },
          { key: 'ucl',  label: 'UCL' },
          { key: 'lcl',  label: 'LCL' },
        ] },
      ];
    },
    defaults: () => {
      const len = (lastDashboardData?.analytics?.sequence?.labels || []).length;
      return { range: [0, Math.max(0, len - 1)], overlays: { mean: true, ucl: true, lcl: true } };
    },
  },
  cThroughput: {
    title: 'Run throughput view',
    helpKey: 'throughput',
    render: fsRenderThroughput,
    spec: () => {
      const len = (lastDashboardData?.analytics?.sequence?.labels || []).length;
      return [
        { type: 'sequenceRange', key: 'range', label: 'Sequence range', max: Math.max(0, len - 1) },
        { type: 'toggle', key: 'series', label: 'Cumulative series', items: [
          { key: 'fetched',  label: 'Fetched' },
          { key: 'notified', label: 'Notified' },
          { key: 'filtered', label: 'Filtered' },
        ] },
      ];
    },
    defaults: () => {
      const len = (lastDashboardData?.analytics?.sequence?.labels || []).length;
      return { range: [0, Math.max(0, len - 1)], series: { fetched: true, notified: true, filtered: true } };
    },
  },
  cSchedule: {
    title: 'Schedule heatmap',
    helpKey: 'schedule',
    render: fsRenderSchedule,
    spec: () => [
      { type: 'multiselect', key: 'days', label: 'Days', options: [...DOW_LABELS] },
      { type: 'rangePair', key: 'hourRange', label: 'Hour range (0–23)', min: 0, max: 23 },
    ],
    defaults: () => ({ days: [...DOW_LABELS], hourRange: [0, 23] }),
  },
  cScatter: {
    title: 'Relevance vs outcome scatter',
    helpKey: 'scatter',
    render: fsRenderScatter,
    spec: () => {
      const opts = [...new Set((lastDashboardData?.analytics?.ragScatter || []).map(p => p.outcome).filter(Boolean))];
      return [
        { type: 'multiselect', key: 'outcomes', label: 'Outcomes', options: opts },
        { type: 'rangePair', key: 'scoreBounds', label: 'Score bounds', min: -50, max: 200, dual: ['scoreMin', 'scoreMax'] },
      ];
    },
    defaults: () => ({
      outcomes: [...new Set((lastDashboardData?.analytics?.ragScatter || []).map(p => p.outcome).filter(Boolean))],
      scoreMin: '', scoreMax: '',
    }),
  },
};

// ── Filter panel widget rendering ──

function fsBuildFilterPanel(spec, state) {
  if (!spec || !spec.length) {
    return '<div class="fs-empty">This chart has no per-chart filter options.</div>';
  }
  return spec.map(w => {
    if (w.type === 'multiselect') return fsBuildMultiselect(w, state);
    if (w.type === 'topN') return fsBuildTopN(w, state);
    if (w.type === 'sort') return fsBuildSort(w, state);
    if (w.type === 'rangeSlider') return fsBuildRangeSlider(w, state);
    if (w.type === 'rangePair') return fsBuildRangePair(w, state);
    if (w.type === 'sequenceRange') return fsBuildSequenceRange(w, state);
    if (w.type === 'toggle') return fsBuildToggle(w, state);
    return '';
  }).join('');
}

function fsBuildMultiselect(w, state) {
  const all = w.options || [];
  const sel = Array.isArray(state[w.key]) ? state[w.key] : [...all];
  const chips = all.length
    ? all.map(o => {
        const on = sel.includes(o);
        return '<button type="button" class="fs-chip' + (on ? ' on' : '') + '" data-fs-multi="' + escHtml(w.key) + '" data-val="' + escHtml(o) + '">' + escHtml(o) + '</button>';
      }).join('')
    : '<span class="fs-empty">No options for this run</span>';
  return ''
    + '<div class="fs-filter-group">'
    + '<div class="fs-label">' + escHtml(w.label)
    + '<span class="fs-chip-actions">'
    + '<button type="button" data-fs-multi-all="' + escHtml(w.key) + '">All</button>'
    + '<button type="button" data-fs-multi-none="' + escHtml(w.key) + '">None</button>'
    + '</span>'
    + '</div>'
    + '<div class="fs-chips">' + chips + '</div>'
    + '</div>';
}

function fsBuildTopN(w, state) {
  const cur = Number(state[w.key]) || 0;
  return ''
    + '<div class="fs-filter-group">'
    + '<div class="fs-label">' + escHtml(w.label) + '</div>'
    + '<div class="fs-input-row">'
    + '<input type="number" min="0" max="' + (w.max || 100) + '" step="1" value="' + cur + '" data-fs-topn="' + escHtml(w.key) + '"/>'
    + '<span class="fs-sub">0 = show all</span>'
    + '</div>'
    + '</div>';
}

function fsBuildSort(w, state) {
  const cur = String(state[w.key] || '');
  const opts = (w.options || []).map(o =>
    '<option value="' + escHtml(o.value) + '"' + (o.value === cur ? ' selected' : '') + '>' + escHtml(o.label) + '</option>'
  ).join('');
  return ''
    + '<div class="fs-filter-group">'
    + '<div class="fs-label">' + escHtml(w.label) + '</div>'
    + '<div class="fs-input-row">'
    + '<select data-fs-sort="' + escHtml(w.key) + '">' + opts + '</select>'
    + '</div>'
    + '</div>';
}

function fsBuildRangeSlider(w, state) {
  const cur = Number(state[w.key]) || 0;
  return ''
    + '<div class="fs-filter-group">'
    + '<div class="fs-label">' + escHtml(w.label) + '</div>'
    + '<div class="fs-range-row">'
    + '<input type="range" min="' + (w.min || 0) + '" max="' + (w.max || 100) + '" step="' + (w.step || 1) + '" value="' + cur + '" data-fs-slider="' + escHtml(w.key) + '"/>'
    + '<span class="fs-range-val" data-fs-slider-val="' + escHtml(w.key) + '">' + cur + '</span>'
    + '</div>'
    + '</div>';
}

function fsBuildSequenceRange(w, state) {
  const max = Math.max(0, Number(w.max) || 0);
  const cur = Array.isArray(state[w.key]) ? state[w.key] : [0, max];
  const lo = Math.max(0, Math.min(max, Number(cur[0]) || 0));
  const hi = Math.max(lo, Math.min(max, Number(cur[1] != null ? cur[1] : max)));
  if (max === 0) {
    return '<div class="fs-filter-group"><div class="fs-label">' + escHtml(w.label) + '</div><div class="fs-empty">Run has no sequence slices.</div></div>';
  }
  return ''
    + '<div class="fs-filter-group">'
    + '<div class="fs-label">' + escHtml(w.label) + '<span class="fs-sub" data-fs-seq-val="' + escHtml(w.key) + '">' + lo + '–' + hi + '</span></div>'
    + '<div class="fs-range-row">'
    + '<span class="fs-sub">From</span>'
    + '<input type="range" min="0" max="' + max + '" step="1" value="' + lo + '" data-fs-seqlo="' + escHtml(w.key) + '" data-fs-seqmax="' + max + '"/>'
    + '</div>'
    + '<div class="fs-range-row">'
    + '<span class="fs-sub">To</span>'
    + '<input type="range" min="0" max="' + max + '" step="1" value="' + hi + '" data-fs-seqhi="' + escHtml(w.key) + '" data-fs-seqmax="' + max + '"/>'
    + '</div>'
    + '</div>';
}

function fsBuildRangePair(w, state) {
  // schedule hour range stores as [lo, hi]; scatter score bounds stores
  // separate scoreMin/scoreMax keys via w.dual.
  if (w.dual) {
    const lo = state[w.dual[0]];
    const hi = state[w.dual[1]];
    return ''
      + '<div class="fs-filter-group">'
      + '<div class="fs-label">' + escHtml(w.label) + '</div>'
      + '<div class="fs-input-row">'
      + '<input type="number" placeholder="min" value="' + escHtml(lo === '' || lo == null ? '' : String(lo)) + '" data-fs-pair="' + escHtml(w.dual[0]) + '"/>'
      + '<input type="number" placeholder="max" value="' + escHtml(hi === '' || hi == null ? '' : String(hi)) + '" data-fs-pair="' + escHtml(w.dual[1]) + '"/>'
      + '</div>'
      + '<div class="fs-sub">Leave blank for unbounded.</div>'
      + '</div>';
  }
  const cur = Array.isArray(state[w.key]) ? state[w.key] : [w.min, w.max];
  return ''
    + '<div class="fs-filter-group">'
    + '<div class="fs-label">' + escHtml(w.label) + '</div>'
    + '<div class="fs-input-row">'
    + '<input type="number" min="' + w.min + '" max="' + w.max + '" value="' + cur[0] + '" data-fs-pair-lo="' + escHtml(w.key) + '" data-fs-pair-min="' + w.min + '" data-fs-pair-max="' + w.max + '"/>'
    + '<input type="number" min="' + w.min + '" max="' + w.max + '" value="' + cur[1] + '" data-fs-pair-hi="' + escHtml(w.key) + '" data-fs-pair-min="' + w.min + '" data-fs-pair-max="' + w.max + '"/>'
    + '</div>'
    + '</div>';
}

function fsBuildToggle(w, state) {
  const cur = state[w.key] || {};
  const items = (w.items || []).map(it =>
    '<label><input type="checkbox" data-fs-toggle="' + escHtml(w.key) + '" data-fs-toggle-key="' + escHtml(it.key) + '"' + (cur[it.key] ? ' checked' : '') + '/> ' + escHtml(it.label) + '</label>'
  ).join('');
  return ''
    + '<div class="fs-filter-group">'
    + '<div class="fs-label">' + escHtml(w.label) + '</div>'
    + '<div class="fs-toggle-list">' + items + '</div>'
    + '</div>';
}

// ── Modal lifecycle ──

function fsEnsureModal() {
  if (document.getElementById('chartFsModal')) return;
  const wrap = document.createElement('div');
  wrap.id = 'chartFsModal';
  wrap.className = 'chart-fs-modal';
  wrap.innerHTML = ''
    + '<div class="chart-fs-backdrop" data-fs-close="1"></div>'
    + '<div class="chart-fs-dialog" role="dialog" aria-modal="true" aria-labelledby="chartFsTitle">'
    +   '<header class="chart-fs-header">'
    +     '<h3 id="chartFsTitle">Chart</h3>'
    +     '<div id="chartFsHelp" class="chart-fs-help"></div>'
    +     '<button type="button" class="chart-fs-close" data-fs-close="1" aria-label="Close">×</button>'
    +   '</header>'
    +   '<div class="chart-fs-body">'
    +     '<aside class="chart-fs-filters" id="chartFsFilters"></aside>'
    +     '<div class="chart-fs-canvas-wrap">'
    +       '<div class="chart-fs-canvas-host"><canvas id="chartFsCanvas"></canvas></div>'
    +     '</div>'
    +   '</div>'
    +   '<footer class="chart-fs-footer">'
    +     '<button type="button" class="btn" id="chartFsReset">Reset filters</button>'
    +     '<span class="grow"></span>'
    +     '<span class="summary" id="chartFsSummary"></span>'
    +   '</footer>'
    + '</div>';
  document.body.appendChild(wrap);
  wrap.addEventListener('click', e => {
    if (e.target.dataset.fsClose != null) fsClose();
  });
  fsBindFilterEvents(wrap);
  document.getElementById('chartFsReset').addEventListener('click', () => {
    const reg = FS_REGISTRY[fsState.chartId];
    if (!reg) return;
    fsState.filters = reg.defaults();
    fsRefreshPanel();
    fsRerender();
  });
  document.addEventListener('keydown', e => {
    const modal = document.getElementById('chartFsModal');
    if (e.key === 'Escape' && modal && modal.classList.contains('open')) fsClose();
  });
}

function fsClose() {
  fsDestroyCharts();
  const m = document.getElementById('chartFsModal');
  if (m) m.classList.remove('open');
  fsState = { chartId: null, filters: {} };
}

function fsOpen(chartId) {
  const reg = FS_REGISTRY[chartId];
  if (!reg) return;
  fsEnsureModal();
  fsState = { chartId, filters: reg.defaults() };
  document.getElementById('chartFsTitle').textContent = reg.title;
  const help = document.getElementById('chartFsHelp');
  if (help) help.textContent = HELP_TEXT[reg.helpKey] || '';
  document.getElementById('chartFsModal').classList.add('open');
  fsRefreshPanel();
  fsRerender();
}

function fsRefreshPanel() {
  const reg = FS_REGISTRY[fsState.chartId];
  if (!reg) return;
  const panel = document.getElementById('chartFsFilters');
  if (!panel) return;
  panel.innerHTML = fsBuildFilterPanel(reg.spec(), fsState.filters);
}

function fsRerender() {
  const reg = FS_REGISTRY[fsState.chartId];
  if (!reg) return;
  fsDestroyCharts();
  reg.render('chartFsCanvas', fsState.filters);
  const sum = document.getElementById('chartFsSummary');
  if (sum) sum.textContent = fsSummarize(fsState.chartId, fsState.filters);
}

function fsSummarize(chartId, fs) {
  const parts = [];
  if (Array.isArray(fs.outcomes)) parts.push(fs.outcomes.length + ' outcomes');
  if (Array.isArray(fs.ratings))  parts.push(fs.ratings.length + ' ratings');
  if (Array.isArray(fs.sources))  parts.push(fs.sources.length + ' sources');
  if (Array.isArray(fs.searches)) parts.push(fs.searches.length + ' searches');
  if (Array.isArray(fs.buckets))  parts.push(fs.buckets.length + ' bands');
  if (Array.isArray(fs.days))     parts.push(fs.days.length + ' days');
  if (Number(fs.topN) > 0)        parts.push('top ' + fs.topN);
  if (Number(fs.minReliability))  parts.push('≥ ' + fs.minReliability + '%');
  return parts.join(' · ');
}

function fsBindFilterEvents(root) {
  root.addEventListener('click', e => {
    const chip = e.target.closest('[data-fs-multi]');
    if (chip) {
      const key = chip.getAttribute('data-fs-multi');
      const val = chip.getAttribute('data-val');
      const cur = Array.isArray(fsState.filters[key]) ? [...fsState.filters[key]] : [];
      const idx = cur.indexOf(val);
      if (idx >= 0) cur.splice(idx, 1); else cur.push(val);
      fsState.filters[key] = cur;
      chip.classList.toggle('on', cur.includes(val));
      fsRerender();
      return;
    }
    const allBtn = e.target.closest('[data-fs-multi-all]');
    if (allBtn) {
      const key = allBtn.getAttribute('data-fs-multi-all');
      const reg = FS_REGISTRY[fsState.chartId];
      const widget = reg && reg.spec().find(w => w.key === key);
      if (widget) fsState.filters[key] = [...(widget.options || [])];
      fsRefreshPanel();
      fsRerender();
      return;
    }
    const noneBtn = e.target.closest('[data-fs-multi-none]');
    if (noneBtn) {
      const key = noneBtn.getAttribute('data-fs-multi-none');
      fsState.filters[key] = [];
      fsRefreshPanel();
      fsRerender();
      return;
    }
  });

  root.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.fsTopn) {
      fsState.filters[t.dataset.fsTopn] = Math.max(0, Number(t.value) || 0);
      fsRerender();
      return;
    }
    if (t.dataset.fsSlider) {
      const k = t.dataset.fsSlider;
      fsState.filters[k] = Number(t.value) || 0;
      const lab = root.querySelector('[data-fs-slider-val="' + CSS.escape(k) + '"]');
      if (lab) lab.textContent = String(fsState.filters[k]);
      fsRerender();
      return;
    }
    if (t.dataset.fsSeqlo || t.dataset.fsSeqhi) {
      const key = t.dataset.fsSeqlo || t.dataset.fsSeqhi;
      const max = Number(t.dataset.fsSeqmax) || 0;
      const cur = Array.isArray(fsState.filters[key]) ? [...fsState.filters[key]] : [0, max];
      if (t.dataset.fsSeqlo) cur[0] = Math.max(0, Math.min(max, Number(t.value) || 0));
      if (t.dataset.fsSeqhi) cur[1] = Math.max(0, Math.min(max, Number(t.value) || 0));
      if (cur[0] > cur[1]) {
        if (t.dataset.fsSeqlo) cur[1] = cur[0];
        else cur[0] = cur[1];
      }
      fsState.filters[key] = cur;
      const lab = root.querySelector('[data-fs-seq-val="' + CSS.escape(key) + '"]');
      if (lab) lab.textContent = cur[0] + '–' + cur[1];
      fsRerender();
      return;
    }
    if (t.dataset.fsPair) {
      const k = t.dataset.fsPair;
      fsState.filters[k] = t.value === '' ? '' : Number(t.value);
      fsRerender();
      return;
    }
    if (t.dataset.fsPairLo || t.dataset.fsPairHi) {
      const key = t.dataset.fsPairLo || t.dataset.fsPairHi;
      const min = Number(t.dataset.fsPairMin);
      const max = Number(t.dataset.fsPairMax);
      const cur = Array.isArray(fsState.filters[key]) ? [...fsState.filters[key]] : [min, max];
      if (t.dataset.fsPairLo) cur[0] = Math.max(min, Math.min(max, Number(t.value) || min));
      if (t.dataset.fsPairHi) cur[1] = Math.max(min, Math.min(max, Number(t.value) || max));
      if (cur[0] > cur[1]) {
        if (t.dataset.fsPairLo) cur[1] = cur[0];
        else cur[0] = cur[1];
      }
      fsState.filters[key] = cur;
      fsRerender();
      return;
    }
  });

  root.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.fsSort) {
      fsState.filters[t.dataset.fsSort] = t.value;
      fsRerender();
      return;
    }
    if (t.dataset.fsToggle) {
      const k = t.dataset.fsToggle;
      const inner = t.dataset.fsToggleKey;
      const cur = { ...(fsState.filters[k] || {}) };
      cur[inner] = !!t.checked;
      fsState.filters[k] = cur;
      fsRerender();
      return;
    }
  });
}

function fsBindCardButtons() {
  if (window.__fsCardButtonsBound) return;
  window.__fsCardButtonsBound = true;
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-fs-chart]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    fsOpen(btn.getAttribute('data-fs-chart'));
  });
}

