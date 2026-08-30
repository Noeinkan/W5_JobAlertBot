// ─────────────────────────────────────────────────────────────────────────────
// dashboard-app split 2/7 — app-charts.js
// Chart.js helpers, cardTitle, help glossary/tooltips
// Classic <script> sharing ONE global scope with its siblings. Load order in
// server.js buildDashboardHtml() matters; app-bootstrap.js must load last.
// ─────────────────────────────────────────────────────────────────────────────

// ── Chart helpers ─────────────────────────────────────────────────────────────
let charts = [];
const chartsById = new Map(); // canvas id → Chart instance (live updates read this)
function destroyCharts() {
  charts.forEach(c => c.destroy());
  charts = [];
  chartsById.clear();
}

function mkChart(id, type, labels, datasets, extra = {}) {
  const ctx = document.getElementById(id);
  if (!ctx) return;
  const { onPick, ...rest } = extra;
  const instance = new Chart(ctx, {
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
  });
  charts.push(instance);
  chartsById.set(id, instance);
  return instance;
}

/** Patch an existing chart's first dataset values in place and trigger a no-animation update. */
function patchChartData(chartId, newLabels, newData, colors) {
  const chart = chartsById.get(chartId);
  if (!chart) return;
  if (newLabels) chart.data.labels = newLabels;
  const ds = chart.data.datasets?.[0];
  if (!ds) return;
  ds.data = newData;
  if (colors) ds.backgroundColor = colors;
  chart.update('none');
}

function colorFromPercent(pct) {
  const alpha = Math.max(0.15, Math.min(0.95, pct / 100));
  return 'rgba(99,102,241,' + alpha + ')';
}

function cardTitle(text, helpKey, canvasId) {
  const tip = HELP_TEXT[helpKey] || '';
  const fs = canvasId
    ? '<button class="fs-btn" type="button" aria-label="Open fullscreen with filters" data-fs-chart="' + escHtml(canvasId) + '" data-fs-help="' + escHtml(helpKey || '') + '" data-fs-title="' + escHtml(text) + '" title="Fullscreen with filters">⤢</button>'
    : '';
  return '<h2>' + escHtml(text)
    + '<button class="help-tip" type="button" aria-label="Help" data-help="' + escHtml(tip) + '">?</button>'
    + fs + '</h2>';
}

function renderHelpGlossary() {
  const rows = [
    ['Filtered Match', 'Row filtered because description/title did not match search intent strongly enough.'],
    ['Filtered Seniority', 'Row removed because seniority signal did not match target level filters.'],
    ['Filtered Profile', 'Row removed because CV/profile fit was Red while PROFILE_FIT_ENABLED is on.'],
    ['Filtered Profile Strict', 'Row removed because PROFILE_FIT_STRICT is on and profile fit was Amber (only Green would pass).'],
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
    tooltip.className = 'help-tooltip';
    tooltip.style.display = 'none';
    document.body.appendChild(tooltip);
  }
  const show = (el) => {
    const tip = el.getAttribute('data-help');
    if (!tip) return;
    tooltip.textContent = tip;
    const rect = el.getBoundingClientRect();
    const tipWidth = tooltip.offsetWidth || 280;
    const left = Math.min(window.innerWidth - tipWidth - 12, Math.max(8, rect.left + 12));
    const top = Math.max(8, rect.bottom + 6);
    tooltip.style.left = left + 'px';
    tooltip.style.top  = top + 'px';
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

  // Delegated hover/focus for table cells — they get a `data-help` from cellHelpText().
  const tbody = document.getElementById('tBody');
  if (tbody && !tbody.__helpBound) {
    tbody.__helpBound = true;
    tbody.addEventListener('mouseover', (e) => {
      const td = e.target.closest && e.target.closest('td[data-help]');
      if (td) show(td);
    });
    tbody.addEventListener('mouseout', (e) => {
      const td = e.target.closest && e.target.closest('td[data-help]');
      if (!td) return;
      // Only hide if we actually left the cell (not just crossed into a child).
      if (!td.contains(e.relatedTarget)) hide();
    });
    tbody.addEventListener('focusin', (e) => {
      const td = e.target.closest && e.target.closest('td[data-help]');
      if (td) show(td);
    });
    tbody.addEventListener('focusout', (e) => {
      const td = e.target.closest && e.target.closest('td[data-help]');
      if (td && !td.contains(e.relatedTarget)) hide();
    });
  }
}

