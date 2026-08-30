// ─────────────────────────────────────────────────────────────────────────────
// dashboard-app split 4/7 — app-table.js
// Data-table render/build/events, column filters
// Classic <script> sharing ONE global scope with its siblings. Load order in
// server.js buildDashboardHtml() matters; app-bootstrap.js must load last.
// ─────────────────────────────────────────────────────────────────────────────

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

/**
 * Match one cell value against a per-column filter string.
 * Cell values may be numbers (e.g. rag_score is an INTEGER column), so we
 * always stringify before text matching — `Number.prototype.toLowerCase`
 * doesn't exist and the raw `.toLowerCase()` used to throw here, silently
 * breaking the whole table when filtering numeric columns like Score.
 * Numeric cells additionally accept comparison operators and ranges:
 *   ">=12", "<=11", ">5", "<5", "=12", "5-11" (or "5..11").
 */
function cellMatchesFilter(cellValue, filterText) {
  const filter = String(filterText).trim();
  if (!filter) return true;

  const num = typeof cellValue === 'number' ? cellValue : Number(cellValue);
  const cellIsNumeric = cellValue != null && cellValue !== '' && !Number.isNaN(num);

  const op = filter.match(/^(>=|<=|>|<|=)\s*(-?\d+(?:\.\d+)?)$/);
  if (op) {
    if (!cellIsNumeric) return false;
    const rhs = Number(op[2]);
    switch (op[1]) {
      case '>=': return num >= rhs;
      case '<=': return num <= rhs;
      case '>':  return num > rhs;
      case '<':  return num < rhs;
      case '=':  return num === rhs;
    }
  }

  const range = filter.match(/^(-?\d+(?:\.\d+)?)\s*(?:\.\.|-)\s*(-?\d+(?:\.\d+)?)$/);
  if (range) {
    const lo = Number(range[1]);
    const hi = Number(range[2]);
    if (cellIsNumeric && lo <= hi) return num >= lo && num <= hi;
  }

  return String(cellValue ?? '').toLowerCase().includes(filter.toLowerCase());
}

function getVisible() {
  let rows = rowsPassingCross(tableRows);

  // hide jobs published >2 months ago (toggle persisted in localStorage)
  if (hideOldJobs) {
    const cutoff = Date.now() - OLD_JOB_THRESHOLD_MS;
    rows = rows.filter(r => !isPostedOlderThan2Months(r, cutoff));
  }

  // global search
  if (globalQ) {
    const q = globalQ.toLowerCase();
    const cols = getCols();
    rows = rows.filter(r => cols.some(c => String(r[c.key] ?? '').toLowerCase().includes(q)));
  }

  // per-column filters
  for (const [k, v] of Object.entries(colFilters)) {
    if (!v) continue;
    rows = rows.filter(r => cellMatchesFilter(r[k], v));
  }

  // sort
  if (sortCol) {
    rows = [...rows].sort((a, b) => {
      if (sortCol === 'posted_at' || sortCol === 'found_at') {
        const ka = parseFlexibleDate(a[sortCol]);
        const kb = parseFlexibleDate(b[sortCol]);
        let cmp;
        if (ka == null && kb == null) cmp = 0;
        else if (ka == null) cmp = 1;
        else if (kb == null) cmp = -1;
        else cmp = ka - kb;
        return sortDir === 'asc' ? cmp : -cmp;
      }
      const av = String(a[sortCol] ?? '').toLowerCase();
      const bv = String(b[sortCol] ?? '').toLowerCase();
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
      cell = '<span class="link-cell-inner">'
        + '<a class="link-btn link-btn-open" href="' + u + '" target="_blank" rel="noreferrer" title="Open original job posting on the source site">'
        + '<span>open</span><span class="arrow" aria-hidden="true">↗</span></a>'
        + '<button type="button" class="link-btn link-btn-highlights job-preview-btn" data-title="' + t + '" data-company="' + co + '" data-source="' + s + '" data-url="' + u + '" title="View stored description with search and RAG highlights">'
        + '<span class="dot" aria-hidden="true"></span><span>highlights</span></button>'
        + '</span>';
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
    } else if (c.key === 'posted_at' && v) {
      cell = escHtml(formatUkDateDdMmYyyy(v));
    } else {
      cell = escHtml(v);
    }
    const titleVal = c.key === 'posted_at' && v ? formatUkDateDdMmYyyy(v) : v;
    const helpText = cellHelpText(c, v);
    return '<td data-key="' + escHtml(c.key) + '"' + (c.wrap ? ' class="wrap"' : '')
      + ' tabindex="0"'
      + ' data-help="' + escHtml(helpText) + '"'
      + ' style="width:' + escHtml(c.width) + ';max-width:' + escHtml(c.width) + '">' + cell + '</td>';
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
  return '<label class="dash-old-jobs-chk" title="Hide rows whose Published date is older than ~2 months from today. Persists across runs in localStorage.">' +
    '<input type="checkbox" id="dashHideOldJobs"' + (hideOldJobs ? ' checked' : '') + '/> ' +
    'Hide jobs &gt; 2 months old' +
    '</label>' +
    '<div class="layout-tools">' +
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
    return '<th ' + w + '><input type="text" placeholder="filter…" title="' + escHtml('Text match — numbers also accept >=, <=, >, <, = or a range (e.g. >=12 or 5-11)') + '" data-filter="' + c.key + '" value="' + escHtml(colFilters[c.key] || '') + '"/></th>';
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
    if (t.id === 'dashHideOldJobs') {
      hideOldJobs = !!t.checked;
      saveHideOldJobsPref(hideOldJobs);
      page = 1;
      renderTable();
      return;
    }
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

