// ─────────────────────────────────────────────────────────────────────────────
// dashboard-app split 5/7 — app-render.js
// render(), description highlighting, job analysis, job-preview modal
// Classic <script> sharing ONE global scope with its siblings. Load order in
// server.js buildDashboardHtml() matters; app-bootstrap.js must load last.
// ─────────────────────────────────────────────────────────────────────────────

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
          <div class="card" data-filter-key="outcome">${cardTitle('Outcome breakdown', 'outcome', 'cOutcome')}<div class="chart-wrap"><canvas id="cOutcome"></canvas></div></div>
          <div class="card" data-filter-key="jobType">${cardTitle('Perm vs Contract', 'contractSplit', 'cContract')}<div class="chart-wrap"><canvas id="cContract"></canvas></div></div>
          <div class="card" data-filter-key="rag_rating">${cardTitle('RAG rating (rated jobs)', 'rag', 'cRag')}<div class="chart-wrap"><canvas id="cRag"></canvas></div></div>
          <div class="card" data-filter-key="profile_rating">${cardTitle('Profile fit (rated jobs)', 'profileFit', 'cProfile')}<div class="chart-wrap"><canvas id="cProfile"></canvas></div></div>
          <div class="card" data-filter-key="source">${cardTitle('Jobs by source', 'source', 'cSource')}<div class="chart-wrap tall"><canvas id="cSource"></canvas></div></div>
          <div class="card" data-filter-key="search_name">${cardTitle('Jobs by search', 'search', 'cSearch')}<div class="chart-wrap tall"><canvas id="cSearch"></canvas></div></div>
          <div class="card" data-filter-key="salaryBucket">${cardTitle('Salary range', 'salary', 'cSalary')}<div class="chart-wrap"><canvas id="cSalary"></canvas></div></div>
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
          <div class="card" data-filter-key="source">${cardTitle('Source quality funnel', 'sourceQuality', 'cSourceQuality')}<div class="chart-wrap tall"><canvas id="cSourceQuality"></canvas></div></div>
          <div class="card" data-filter-key="source">${cardTitle('Source reliability snapshot', 'reliability', 'cReliability')}<div class="chart-wrap"><canvas id="cReliability"></canvas></div></div>
          <div class="card" data-filter-key="search_name">${cardTitle('Search effectiveness heatmap', 'searchHeatmap', 'cSearchHeat')}<div class="chart-wrap xtall"><canvas id="cSearchHeat"></canvas></div></div>
          <div class="card" data-filter-key="outcome">${cardTitle('Filter pareto', 'pareto', 'cPareto')}<div class="chart-wrap tall"><canvas id="cPareto"></canvas></div></div>
          <div class="card">${cardTitle('Outcomes over sequence', 'outcomesOverTime', 'cOutcomeTime')}<div class="chart-wrap tall"><canvas id="cOutcomeTime"></canvas></div></div>
          <div class="card">${cardTitle('SPC control view (notified)', 'control', 'cControl')}<div class="chart-wrap"><canvas id="cControl"></canvas></div></div>
          <div class="card">${cardTitle('Run throughput view', 'throughput', 'cThroughput')}<div class="chart-wrap"><canvas id="cThroughput"></canvas></div></div>
          <div class="card">${cardTitle('Schedule heatmap', 'schedule', 'cSchedule')}<div class="chart-wrap xtall"><canvas id="cSchedule"></canvas></div></div>
          <div class="card" data-filter-key="outcome">${cardTitle('Relevance vs outcome scatter', 'scatter', 'cScatter')}<div class="chart-wrap"><canvas id="cScatter"></canvas></div></div>
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

    <section class="section" data-section="trend" id="trendSection" style="display:none">
      <div class="section-header">
        <span class="chev">▶</span>
        <h2>Notify rate — recent runs
          <span class="help-tip" data-help="What: Notify rate (% of fetched rows that got through all filters) across the most recent runs, with a trailing 7-run mean baseline. Why: Tell today's run from the baseline at a glance. Read: Flat or rising is healthy; a dip below the baseline means source or filter drift.">?</span>
        </h2>
        <span class="section-meta">trend across recent CSV runs</span>
      </div>
      <div class="section-body">
        <div class="chart-wrap tall"><canvas id="cTrend"></canvas></div>
      </div>
    </section>
  `;

  // Data table is rendered into a placeholder in #preMain (right under the bot log).
  const dataTableBody = document.getElementById('dataTableBody');
  if (dataTableBody) dataTableBody.innerHTML = buildTableHTML(tableRows);

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
  const heatOutcomes = ['new', 'already_seen', 'filtered_match', 'filtered_seniority', 'filtered_salary', 'filtered_rag', 'filtered_profile', 'filtered_profile_strict'];
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

