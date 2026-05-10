import fs from 'fs';
import http from 'http';
import path from 'path';
import {
  ALL_JOBS_ID,
  CHART_BUNDLE,
  PUBLIC_DIR,
  RUNS_DIR,
  getWriteDb,
  listCsvFiles,
} from './data-access.js';
import {
  getAllJobsAggregate,
  getCsvAggregate,
  invalidateAllAggregateCaches,
} from './aggregate.js';
import {
  getBotProc,
  getBotStatus,
  getSseClients,
  startBot,
} from './bot-process.js';
import { tokenOk } from './auth.js';

function buildDashboardHtml(basePath) {
  const bp = basePath || '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Job Alert Bot — Run Dashboard</title>
<link rel="stylesheet" href="${bp}/dashboard.css"/>
<script src="${bp}/vendor/chart.umd.js"></script>
<script>window.__DASHBOARD_BASE__=${JSON.stringify(basePath)};</script>
<script src="${bp}/dashboard-app.js" defer></script>
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
<div id="preMain">
  <section class="section" data-section="log" id="logSection" style="display:none">
    <div class="section-header">
      <span class="chev">▶</span>
      <h2><span class="log-dot"></span>Bot log</h2>
      <span class="section-meta">click to expand · streams while a run is active</span>
    </div>
    <div class="section-body">
      <pre id="logPanel"></pre>
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
</div>
<main id="main">
  <div id="loading">Loading…</div>
</main>
</body>
</html>`;
}

function serveStatic(res, filePath, contentType, cacheControl = 'public, max-age=86400') {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': cacheControl,
  });
  fs.createReadStream(filePath).pipe(res);
}

export function createDashboardServer({ port, host, token, basePath }) {
  const HTML = buildDashboardHtml(basePath);

  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const pathname = basePath && url.pathname.startsWith(basePath)
      ? url.pathname.slice(basePath.length) || '/'
      : url.pathname;

    if (pathname === '/vendor/chart.umd.js' || pathname === '/vendor/chart.umd.min.js') {
      if (!fs.existsSync(CHART_BUNDLE)) {
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Chart.js bundle missing (npm install chart.js).');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
      });
      fs.createReadStream(CHART_BUNDLE).pipe(res);
      return;
    }

    if (pathname === '/dashboard.css') {
      serveStatic(res, path.join(PUBLIC_DIR, 'dashboard.css'), 'text/css; charset=utf-8');
      return;
    }

    if (pathname === '/dashboard-app.js') {
      serveStatic(res, path.join(PUBLIC_DIR, 'dashboard-app.js'), 'application/javascript; charset=utf-8');
      return;
    }

    if (pathname === '/api/files') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(listCsvFiles()));
      return;
    }

    if (pathname === '/api/bot/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getBotStatus()));
      return;
    }

    if (pathname === '/api/bot/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection':    'keep-alive',
      });
      res.write(`data: ${JSON.stringify({ type: 'status', status: getBotStatus() })}\n\n`);
      const sseClients = getSseClients();
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if ((pathname === '/api/bot/start-once' || pathname === '/api/bot/start-daemon') && req.method === 'POST') {
      if (!tokenOk(req, res, token)) return;
      if (getBotProc()) { res.writeHead(409); res.end('Already running'); return; }
      const mode = pathname.endsWith('once') ? 'once' : 'daemon';
      startBot(mode);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (pathname === '/api/bot/stop' && req.method === 'POST') {
      if (!tokenOk(req, res, token)) return;
      const botProc = getBotProc();
      if (botProc) botProc.kill('SIGTERM');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (pathname === '/api/job-action' && req.method === 'POST') {
      if (!tokenOk(req, res, token)) return;
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { title, company, source, applied, discarded, expired } = JSON.parse(body);
          if (!title || !source) { res.writeHead(400); res.end('Missing fields'); return; }
          const db = getWriteDb();
          db.prepare('UPDATE jobs SET applied = ?, discarded = ?, expired = ? WHERE title = ? AND (company = ? OR (company IS NULL AND ? IS NULL)) AND source = ?')
            .run(applied ? 1 : 0, discarded ? 1 : 0, expired ? 1 : 0, title, company || '', company || '', source);
          invalidateAllAggregateCaches();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(500); res.end(e.message);
        }
      });
      return;
    }

    if (pathname === '/api/data') {
      const file = url.searchParams.get('file');
      if (!file || file.includes('..') || !file.endsWith('.csv')) {
        res.writeHead(400); res.end('Bad file param'); return;
      }
      if (file === ALL_JOBS_ID) {
        try {
          const data = getAllJobsAggregate();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
        } catch (e) {
          res.writeHead(500); res.end(e.message);
        }
        return;
      }
      const filePath = path.join(RUNS_DIR, file);
      if (!fs.existsSync(filePath)) {
        res.writeHead(404); res.end('Not found'); return;
      }
      try {
        const data = getCsvAggregate(filePath, file);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      } catch (e) {
        res.writeHead(500); res.end(e.message);
      }
      return;
    }

    if (pathname === '/api/trend') {
      const limit = Math.min(100, Math.max(5, Number(url.searchParams.get('limit')) || 30));
      const files = listCsvFiles().slice(0, limit).reverse();
      const series = [];
      for (const f of files) {
        try {
          const data = f === ALL_JOBS_ID ? getAllJobsAggregate() : getCsvAggregate(path.join(RUNS_DIR, f), f);
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
}
