// ─────────────────────────────────────────────────────────────────────────────
// dashboard-app split 7/7 — app-bootstrap.js
// files/trend/init(), bot controls, live loop + SSE, top-level boot (loads LAST)
// Classic <script> sharing ONE global scope with its siblings. Load order in
// server.js buildDashboardHtml() matters; app-bootstrap.js must load last.
// ─────────────────────────────────────────────────────────────────────────────

// ── Boot ──────────────────────────────────────────────────────────────────────
const ALL_JOBS_VALUE = '__all__';
const ALL_JOBS_LABEL = '★ All jobs (deduped from DB)';

async function loadFile(filename) {
  document.getElementById('main').innerHTML = '<div id="loading">Loading…</div>';
  const url = filename === ALL_JOBS_VALUE
    ? API_BASE + '/api/data/all'
    : API_BASE + '/api/data?file=' + encodeURIComponent(filename);
  const res = await fetch(url);
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  const d = data.runAt ? new Date(data.runAt).toLocaleString('en-GB') : '';
  document.getElementById('meta').textContent = d + (data.trigger ? '  ·  ' + data.trigger : '');
  render(data);
  // The user picked a new view. liveModeActive is driven by bot status (SSE);
  // we only flip the table-delta flag here so KPI/chart ticks keep running.
  const selEl = document.getElementById('fileSelect');
  const onAllJobs = !!selEl && selEl.value === ALL_JOBS_VALUE;
  liveTableActive = onAllJobs;
  liveMaxRowId = onAllJobs ? computeMaxRowId(data.rows || []) : liveMaxRowId;
  liveUpdateHeaderChrome();
}

function computeMaxRowId(rows) {
  let max = 0;
  for (const r of rows) {
    if (typeof r._id === 'number' && r._id > max) max = r._id;
  }
  return max;
}

function populateFileSelect(sel, files, preserveValue) {
  sel.innerHTML = '';
  const allOpt = document.createElement('option');
  allOpt.value = ALL_JOBS_VALUE;
  allOpt.textContent = ALL_JOBS_LABEL;
  sel.appendChild(allOpt);
  files.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f;
    opt.textContent = f.replace(/^run_/, '').replace(/(_oneshot|_bot)\.csv$/, ' ($1).csv');
    sel.appendChild(opt);
  });
  if (preserveValue && (preserveValue === ALL_JOBS_VALUE || files.includes(preserveValue))) {
    sel.value = preserveValue;
  } else {
    sel.value = ALL_JOBS_VALUE;
  }
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
    const strictHint = data.strict
      ? '<p class="profile-fit-note profile-fit-note--strict"><strong>Strict mode</strong> — only <strong>Profile Green</strong> jobs are eligible for Discord (Amber is filtered).</p>'
      : '';
    mount.innerHTML =
      '<section class="profile-fit-strip" aria-label="Profile fit summary">'
      + '<div class="profile-fit-strip-head">'
      + '<span class="' + badgeClass + '">' + badgeText + '</span>'
      + '<span class="profile-fit-title">CV-aligned second score</span>'
      + ver
      + '</div>'
      + '<div class="profile-fit-strip-path" title="' + esc(data.profilePath) + '">' + esc(pathShort || data.profilePath || '') + '</div>'
      + strictHint
      + body
      + '<p class="profile-fit-hint">Table columns <strong>Profile</strong> / <strong>Prof score</strong> / <strong>Prof reason</strong> · tune patterns in <code>data/profile.json</code> · set <code>PROFILE_FIT_STRICT=true</code> for strict mode</p>'
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
  populateFileSelect(sel, files);
  sel.addEventListener('change', () => loadFile(sel.value).then(() => {
    // After a manual switch, re-evaluate live mode based on the current bot status.
    refreshLiveMode(stateBadge?.classList?.contains('running'));
  }));
  initSectionToggles();
  fsBindCardButtons();
  loadTrend();
  await loadFile(sel.value);
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
const sendPendingBtn = document.getElementById('sendPendingBtn');
const downloadLogBtn = document.getElementById('downloadLogBtn');
let   needsRefresh  = false;

function readAttachmentFilename(res, fallback) {
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^";]+)"?/i);
  return match && match[1] ? match[1] : fallback;
}

function saveBlob(blob, filename) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

function updateDownloadLogButton() {
  if (!downloadLogBtn) return;
  downloadLogBtn.disabled = false;
}

function downloadCurrentLog() {
  const content = logPanel.textContent;
  if (!content) return;

  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  saveBlob(blob, 'job-alert-bot-' + stamp + '.log');
}

async function downloadServerLog() {
  const res = await fetchWithDashboardToken(API_BASE + '/api/bot/log');
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || 'Failed to download bot log');
  }
  const blob = await res.blob();
  saveBlob(blob, readAttachmentFilename(res, 'job-alert-bot.log'));
}

async function handleDownloadLog() {
  try {
    await downloadServerLog();
  } catch (err) {
    if (logPanel.textContent) {
      downloadCurrentLog();
      return;
    }
    alert(err.message);
  }
}

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
  // Toggle the live polling loop to match bot status.
  refreshLiveMode(running);
  if (!running) {
    if (needsRefresh) { needsRefresh = false; refreshFiles(); }
    // One final snapshot after the run ends so the user sees the last numbers without needing to reload.
    // refreshLiveMode(false) already reloads CSV views; reload All Jobs here for the heavy charts.
    const sel = document.getElementById('fileSelect');
    if (sel && sel.value === ALL_JOBS_VALUE) {
      loadFile(ALL_JOBS_VALUE).catch(() => {});
    }
  }
}

async function refreshFiles() {
  try {
    const res   = await fetch(API_BASE + '/api/files');
    const files = await res.json();
    const sel   = document.getElementById('fileSelect');
    const cur   = sel.value;
    populateFileSelect(sel, files, cur);
    if (sel.value !== cur) loadFile(sel.value);
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
  updateDownloadLogButton();
  showLogSection();
  needsRefresh = true;
  botAction('start-once');
});

startBotBtn.addEventListener('click', () => {
  logPanel.textContent = '';
  updateDownloadLogButton();
  showLogSection();
  botAction('start-daemon');
});

stopBotBtn.addEventListener('click', () => botAction('stop'));

if (sendPendingBtn) {
  sendPendingBtn.addEventListener('click', async () => {
    sendPendingBtn.disabled = true;
    const prev = sendPendingBtn.textContent;
    sendPendingBtn.textContent = '📣 Posting…';
    showLogSection();
    logPanel.textContent = '';
    try {
      const res = await fetchWithDashboardToken(API_BASE + '/api/bot/send-pending', { method: 'POST' });
      const txt = await res.text();
      let body;
      try { body = JSON.parse(txt); } catch { body = { raw: txt }; }
      if (!res.ok) {
        alert('Send pending failed: ' + (body.error || body.raw || ('HTTP ' + res.status)));
      } else {
        needsRefresh = true;
        // brief summary so the user sees what happened without leaving the page
        const sent = body.sent ?? body.total ?? 0;
        const mode = body.mode || 'unknown';
        alert((sent > 0
          ? `✅ Sent ${sent} pending job${sent === 1 ? '' : 's'} via ${mode}.`
          : `ℹ Nothing pending. (mode=${mode})`));
      }
    } catch (e) {
      alert('Send pending error: ' + (e && e.message || e));
    } finally {
      sendPendingBtn.disabled = false;
      sendPendingBtn.textContent = prev;
    }
  });
}

const diagnoseBtn = document.getElementById('diagnoseBtn');
if (diagnoseBtn) {
  diagnoseBtn.addEventListener('click', showDiagnose);
}

async function showDiagnose() {
  try {
    const res = await fetchWithDashboardToken(API_BASE + '/api/bot/diagnose', { method: 'GET' });
    if (!res.ok) {
      alert('Diagnose failed: HTTP ' + res.status);
      return;
    }
    const d = await res.json();
    const lines = [];
    lines.push(`Bot: ${d.botRunning ? 'running' : 'NOT running'} (${d.botManagedBy || 'unknown'})`);
    const dc = d.discord || {};
    lines.push(`Discord: token=${dc.tokenPresent ? 'yes' : 'no'} channel=${dc.channelPresent ? 'yes' : 'no'} webhook=${dc.webhookPresent ? 'yes' : 'no'}`);
    const c = d.counts || {};
    lines.push(`Jobs: total=${c.totalJobs ?? 0} pending=${c.pending ?? 0} unnotified=${c.unnotified ?? 0} already-sent=${c.alreadySent ?? 0} filtered=${c.filtered ?? 0}`);
    if (Array.isArray(c.byFilter) && c.byFilter.length) {
      lines.push('Top filter reasons: ' + c.byFilter.map(r => `${r.reason}=${r.n}`).join(', '));
    }
    if (Array.isArray(d.silentSources) && d.silentSources.length) {
      lines.push('Silent sources (last 24h, 0-result runs): ' + d.silentSources.map(s => `${s.source}=${s.emptyRuns}`).join(', '));
    }
    if (d.lastNewJob) {
      lines.push(`Last new unfiltered job: ${d.lastNewJob.found_at} — ${d.lastNewJob.source} "${d.lastNewJob.title}"`);
    }
    if (Array.isArray(d.hints) && d.hints.length) {
      lines.push('');
      lines.push('Hints:');
      for (const h of d.hints) lines.push('  • ' + h);
    }
    alert(lines.join('\n'));
  } catch (e) {
    alert('Diagnose error: ' + (e && e.message || e));
  }
}

if (downloadLogBtn) {
  downloadLogBtn.addEventListener('click', async e => {
    e.stopPropagation();
    await handleDownloadLog();
  });
  updateDownloadLogButton();
}

// ── Live updates while the bot is running ────────────────────────────────────
//
// Two layers of "live":
//   • Overview KPIs + the 5 small overview charts always tick when the bot is running
//     (cheap — single /api/summary per poll) regardless of which view is selected.
//   • Table rows only tick when the user is on "All jobs (deduped)". Per-CSV views
//     render from a frozen snapshot; on run-finish we auto-reload the CSV once.
let liveModeActive    = false;   // true when the bot is running (any view)
let liveTableActive   = false;   // true when live table-row deltas are being applied (All Jobs view)
let liveMaxRowId      = 0;       // monotonic id watermark — only fetch rows newer than this
let liveTickTimer     = null;    // setInterval handle for the live polling loop
let liveTickCadence   = 3000;    // current poll cadence in ms (adaptive)
let liveBaseCadence   = 3000;    // base cadence while activity is detected
let liveIdleCadence   = 8000;    // slower cadence when no new rows for a while
let liveStaleTicks    = 0;       // consecutive polls with no new rows → drift to idle cadence
let liveLastTickAt    = 0;       // ms timestamp of the last successful tick
let livePrevMaxId     = 0;       // last seen global max id (for the "N new since open" pill)
let liveSessionStartMaxId = 0;   // max id at the moment the user opened this dashboard session
let liveSessionNewCount   = 0;   // rows inserted since session start (any view)
const LIVE_TICK_BACKOFF_MS = 12000; // back off hard when the server is busy

function liveUpdateHeaderChrome() {
  const meta = document.getElementById('meta');
  if (!meta) return;
  meta.classList.toggle('live-on', !!liveModeActive);
  if (liveModeActive) {
    if (!meta.querySelector('.live-pill')) {
      const pill = document.createElement('span');
      pill.className = 'live-pill';
      pill.title = 'Live mode: dashboard numbers tick up automatically while the bot is running.';
      pill.textContent = '● Live';
      meta.prepend(pill);
    }
    const stamp = document.createElement('span');
    stamp.className = 'live-stamp';
    stamp.dataset.role = 'live-stamp';
    stamp.textContent = 'updated just now';
    const old = meta.querySelector('.live-stamp');
    if (old) old.remove();
    meta.appendChild(stamp);
    renderSessionPill();
  } else {
    const pill = meta.querySelector('.live-pill');
    if (pill) pill.remove();
    const stamp = meta.querySelector('.live-stamp');
    if (stamp) stamp.remove();
    const sp = meta.querySelector('.session-pill');
    if (sp) sp.remove();
  }
}

function renderSessionPill() {
  const meta = document.getElementById('meta');
  if (!meta) return;
  let pill = meta.querySelector('.session-pill');
  if (liveSessionNewCount <= 0) {
    if (pill) pill.remove();
    return;
  }
  const label = liveTableActive
    ? `+${liveSessionNewCount} new in table since you opened`
    : `+${liveSessionNewCount} new jobs since you opened (open “All jobs” to see them)`;
  if (!pill) {
    pill = document.createElement('span');
    pill.className = 'session-pill';
    pill.title = 'New rows inserted into the database since this dashboard session started.';
    meta.appendChild(pill);
  }
  pill.textContent = label;
}

function bumpLiveStamp() {
  const stamp = document.querySelector('[data-role="live-stamp"]');
  if (stamp) stamp.textContent = 'updated ' + new Date().toLocaleTimeString('en-GB');
}

/**
 * Patch the overview cards (KPIs + 5 visible charts) in place from a fresh /api/summary response.
 * Does not touch table state, fullscreen modals, or the heavier analytics charts.
 */
function patchOverview(summary) {
  // KPI text nodes — IDs already in the markup (#kpiTotal / kpiNotified / … / kpiExpired).
  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(val ?? 0);
  };
  setText('kpiTotal',     summary.total);
  setText('kpiNotified',  summary.byOutcome.new || 0);
  setText('kpiSeen',      summary.byOutcome.already_seen || 0);
  setText('kpiFiltered',  Object.entries(summary.byOutcome).filter(([k]) => k.startsWith('filtered')).reduce((s, [, v]) => s + v, 0));
  setText('kpiContract',  summary.contractCount);
  setText('kpiPerm',      summary.permCount);
  setText('kpiApplied',   summary.byOutcome.applied || 0);
  setText('kpiDiscarded', summary.byOutcome.discarded || 0);
  setText('kpiExpired',   summary.byOutcome.expired || 0);

  // Doughnut: outcome breakdown
  const outLabels = Object.keys(summary.byOutcome);
  patchChartData('cOutcome',
    outLabels,
    outLabels.map(l => summary.byOutcome[l]),
    outLabels.map(l => OUTCOME_COLORS[l] || '#6366f1'));

  // Doughnut: perm vs contract
  patchChartData('cContract',
    ['Perm', 'Contract'],
    [summary.permCount, summary.contractCount],
    ['#64748b', '#38bdf8']);

  // Doughnut: RAG
  const ragLabels = Object.keys(summary.byRag || {});
  patchChartData('cRag',
    ragLabels,
    ragLabels.map(l => summary.byRag[l]),
    ragLabels.map(l => RAG_COLORS[l] || '#94a3b8'));

  // Doughnut: profile
  const profileLabels = Object.keys(summary.byProfile || {});
  patchChartData('cProfile',
    profileLabels,
    profileLabels.map(l => summary.byProfile[l]),
    profileLabels.map(l => RAG_COLORS[l] || '#94a3b8'));

  // Bar: jobs by source
  const srcLabels = Object.keys(summary.bySource).sort((a, b) => summary.bySource[b] - summary.bySource[a]);
  patchChartData('cSource',
    srcLabels,
    srcLabels.map(l => summary.bySource[l]),
    PALETTE.slice(0, srcLabels.length));
}

/** Live tick: pull only jobs inserted since the watermark + a fresh summary. */
async function liveTick() {
  if (!liveModeActive) return;
  try {
    const summaryRes = await fetch(API_BASE + '/api/summary');
    if (!summaryRes.ok) { liveTickCadence = LIVE_TICK_BACKOFF_MS; return; }
    const summary = await summaryRes.json();

    // Track session-wide new-row count before we move the watermark.
    if (typeof summary.maxId === 'number') {
      if (liveSessionStartMaxId === 0) {
        // First tick of the session — seed both watermarks so we don't count the entire DB.
        liveSessionStartMaxId = summary.maxId;
        livePrevMaxId = summary.maxId;
      } else if (summary.maxId > livePrevMaxId) {
        liveSessionNewCount += (summary.maxId - livePrevMaxId);
        livePrevMaxId = summary.maxId;
      } else if (summary.maxId < livePrevMaxId) {
        // Database shrank (e.g. retention job) — reset watermark without inflating the counter.
        livePrevMaxId = summary.maxId;
      }
    }

    // Always update totals & overview charts (cheap and important for the live feel).
    patchOverview(summary);
    bumpLiveStamp();
    renderSessionPill();

    // Table deltas only apply on the "All jobs" view (CSV views are frozen snapshots).
    if (liveTableActive) {
      const deltaUrl = API_BASE + '/api/data/all?since=' + encodeURIComponent(String(liveMaxRowId || 0));
      const deltaRes = await fetch(deltaUrl);
      if (deltaRes.ok) {
        const delta = await deltaRes.json();
        if (delta && Array.isArray(delta.rows) && delta.rows.length && typeof renderTable === 'function') {
          const seen = new Set(tableRows.map(r => (r.title ?? '') + '\0' + (r.company ?? '') + '\0' + (r.source ?? '')));
          const added = [];
          for (const r of delta.rows) {
            const key = (r.title ?? '') + '\0' + (r.company ?? '') + '\0' + (r.source ?? '');
            if (seen.has(key)) continue;
            seen.add(key);
            added.push(r);
          }
          if (added.length) {
            tableRows = added.concat(tableRows);
            liveJustAddedCount = added.length;
            renderTable();
          }
        }
        if (typeof delta.maxId === 'number' && delta.maxId > liveMaxRowId) {
          liveMaxRowId = delta.maxId;
        } else if (typeof summary.maxId === 'number' && summary.maxId > liveMaxRowId) {
          liveMaxRowId = summary.maxId;
        }
      }
    } else if (typeof summary.maxId === 'number' && summary.maxId > liveMaxRowId) {
      liveMaxRowId = summary.maxId;
    }

    // Adaptive cadence: poll faster while activity is detected, slow down when idle.
    liveStaleTicks = 0;
    liveLastTickAt = Date.now();
    if (liveTickCadence !== liveBaseCadence) {
      liveTickCadence = liveBaseCadence;
      restartLiveLoopTimer();
    }
  } catch (_) {
    // network blip — slow down briefly and leave the existing values in place
    liveStaleTicks++;
    if (liveStaleTicks >= 3) {
      liveTickCadence = LIVE_TICK_BACKOFF_MS;
      restartLiveLoopTimer();
    }
  }
}

function startLiveLoop() {
  if (liveTickTimer) return;
  if (!liveModeActive) return;
  liveTickCadence = liveBaseCadence;
  liveTickTimer = setInterval(liveTick, liveTickCadence);
  // Kick once immediately so the first paint feels snappy.
  liveTick();
  // Drift to idle cadence after a stretch of inactivity.
  liveIdleTimer = setInterval(() => {
    if (!liveModeActive) return;
    if (liveStaleTicks > 0) {
      liveStaleTicks++;
      if (liveStaleTicks >= 4 && liveTickCadence !== liveIdleCadence) {
        liveTickCadence = liveIdleCadence;
        restartLiveLoopTimer();
      }
    } else {
      liveStaleTicks = 1;
    }
  }, liveBaseCadence);
}

let liveIdleTimer = null;
function restartLiveLoopTimer() {
  if (liveTickTimer) { clearInterval(liveTickTimer); liveTickTimer = null; }
  if (!liveModeActive) return;
  liveTickTimer = setInterval(liveTick, liveTickCadence);
}

function stopLiveLoop() {
  if (liveTickTimer)  { clearInterval(liveTickTimer);  liveTickTimer = null; }
  if (liveIdleTimer)  { clearInterval(liveIdleTimer);  liveIdleTimer = null; }
}

function refreshLiveMode(botRunning) {
  const selEl = document.getElementById('fileSelect');
  const onAllJobs = !!selEl && selEl.value === ALL_JOBS_VALUE;
  // Live mode is meaningful whenever the bot is running. Table-row deltas are
  // only applied on the "All jobs" view; KPI/chart ticks run on every view.
  const want = !!botRunning;
  const tableWant = want && onAllJobs;
  if (want && !liveModeActive) {
    liveModeActive = true;
    liveTableActive = tableWant;
    liveStaleTicks = 0;
    liveTickCadence = liveBaseCadence;
    liveUpdateHeaderChrome();
    startLiveLoop();
  } else if (!want && liveModeActive) {
    liveModeActive = false;
    liveTableActive = false;
    liveUpdateHeaderChrome();
    stopLiveLoop();
    // Run finished while user was on a CSV view — reload the snapshot so the
    // new rows from the just-finished run are visible.
    if (selEl && selEl.value && selEl.value !== ALL_JOBS_VALUE) {
      const finishedFile = selEl.value;
      loadFile(finishedFile).catch(() => {});
    }
  } else {
    if (liveTableActive !== tableWant) {
      liveTableActive = tableWant;
      renderSessionPill();
    }
    if (want) startLiveLoop();
  }
}

// keep a running tally of "new" rows since the dashboard was opened, shown briefly after each tick
let liveJustAddedCount = 0;

// SSE connection
function connectSSE() {
  const es = new EventSource(API_BASE + '/api/bot/stream');
  es.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'status') applyStatus(msg.status);
    if (msg.type === 'log') {
      logPanel.textContent += msg.line;
      updateDownloadLogButton();
      logPanel.scrollTop = logPanel.scrollHeight;
    }
  };
  es.onerror = () => { es.close(); setTimeout(connectSSE, 3000); };
}

// Load initial bot state then open SSE
fetch(API_BASE + '/api/bot/status').then(r => r.json()).then(s => { applyStatus(s); connectSSE(); });