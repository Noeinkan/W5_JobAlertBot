import fs from 'fs';
import http from 'http';
import path from 'path';
import {
  CHART_BUNDLE,
  PUBLIC_DIR,
  RUNS_DIR,
  getAllJobsSummary,
  getJobsSinceId,
  getMaxJobsId,
  getWriteDb,
  getJobPreview,
  listCsvFiles,
  rowFromDbJob,
} from './data-access.js';
import {
  getAllJobsAggregate,
  getCsvAggregate,
  invalidateAllAggregateCaches,
} from './aggregate.js';
import {
  getBotStatus,
  getSseClients,
  readLiveStatus,
  runSendPending,
  startBot,
  startPm2LogTail,
  stopBot,
  stopPm2LogTail,
} from './bot-process.js';
import { hasDiscordBotConfig, hasDiscordWebhookConfig, env as appEnv } from '../config.js';
import { tokenOk } from './auth.js';
import { appConfig, env } from '../config.js';

function readProfileSummary() {
  const profilePath = env.profileFitPath;
  const enabled = env.profileFitEnabled;
  try {
    if (!fs.existsSync(profilePath)) {
      return {
        enabled,
        strict: env.profileFitStrict,
        profilePath,
        ok: false,
        error: 'file_missing',
        northStar: '',
        version: null,
      };
    }
    const data = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    return {
      enabled,
      strict: env.profileFitStrict,
      profilePath,
      ok: true,
      version: data.version ?? null,
      northStar: typeof data.northStar === 'string' ? data.northStar : '',
    };
  } catch (e) {
    return {
      enabled,
      strict: env.profileFitStrict,
      profilePath,
      ok: false,
      error: e.message,
      northStar: '',
      version: null,
    };
  }
}

function buildDashboardHtml(basePath, profileFitEnabled) {
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
<script>window.__PROFILE_FIT_ENABLED__=${JSON.stringify(profileFitEnabled)};</script>
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
    <button id="startBotBtn" class="run-btn" title="Start the bot scheduler (delegates to PM2 on prod)">▶ Start Bot</button>
    <button id="stopBotBtn"  class="run-btn stop" title="Stop the running process" style="display:none">■ Stop</button>
    <button id="sendPendingBtn" class="run-btn" title="Post already-pending jobs to Discord right now (without re-running sources)">📣 Send pending now</button>
    <button id="diagnoseBtn" class="run-btn ghost" title="Explain why no jobs are being posted" style="margin-left:.25rem">🩺 Diagnose</button>
  </div>
</header>
<div id="preMain">
  <div id="profileFitMount" class="profile-fit-mount"></div>
  <section class="section" data-section="log" id="logSection" style="display:none">
    <div class="section-header">
      <span class="chev">▶</span>
      <h2><span class="log-dot"></span>Bot log</h2>
      <span class="section-meta">click to expand · streams while a run is active</span>
      <button id="downloadLogBtn" class="log-download-btn" type="button" disabled>Download log</button>
    </div>
    <div class="section-body">
      <pre id="logPanel"></pre>
    </div>
  </section>
  <section class="section open section-toggle-none" data-section="table" id="dataTableSection">
    <div class="section-header">
      <span class="chev">▶</span>
      <h2>Data table</h2>
      <span class="section-meta" id="tableSectionMeta">always visible · chart slices and chips cross-filter it</span>
    </div>
    <div class="section-body" id="dataTableBody"></div>
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
  const HTML = buildDashboardHtml(basePath, env.profileFitEnabled);
  const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '0:0:0:0:0:0:0:1']);
  const enforceTokenGlobally = !!token && !LOOPBACK.has(host);

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const pathname = basePath && url.pathname.startsWith(basePath)
      ? url.pathname.slice(basePath.length) || '/'
      : url.pathname;

    if (enforceTokenGlobally && !tokenOk(req, res, token)) return;

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

    if (pathname === '/api/profile-summary') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(readProfileSummary()));
      return;
    }

    if (pathname === '/api/files') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(listCsvFiles()));
      return;
    }

    if (pathname === '/api/bot/status') {
      readLiveStatus().then(status => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status));
      }).catch(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(getBotStatus()));
      });
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
      // Tail the bot log so SSE delivers log lines even when the bot is
      // PM2-managed (in which case its stdout is not a child of this process).
      startPm2LogTail(appConfig.logFilePath);
      req.on('close', () => {
        sseClients.delete(res);
        // If no more listeners, stop the tail to avoid idle work.
        if (sseClients.size === 0) stopPm2LogTail();
      });
      return;
    }

    if (pathname === '/api/bot/log' && req.method === 'GET') {
      if (!tokenOk(req, res, token)) return;
      if (!fs.existsSync(appConfig.logFilePath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Bot log not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${path.basename(appConfig.logFilePath)}"`,
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(appConfig.logFilePath).pipe(res);
      return;
    }

    if ((pathname === '/api/bot/start-once' || pathname === '/api/bot/start-daemon') && req.method === 'POST') {
      if (!tokenOk(req, res, token)) return;
      const mode = pathname.endsWith('once') ? 'once' : 'daemon';
      const status = getBotStatus();
      // Already-running check covers both spawn child and PM2-managed state.
      if (status.state === 'running' && status.managedBy !== 'pm2') {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, reason: 'already_running' }));
        return;
      }
      try {
        const result = await startBot(mode);
        res.writeHead(result.ok ? 200 : 409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
      return;
    }

    if (pathname === '/api/bot/diagnose' && req.method === 'GET') {
      if (!tokenOk(req, res, token)) return;
      try {
        const status = await readLiveStatus();
        const db = getWriteDb();
        const counts = {
          totalJobs:     db.prepare("SELECT COUNT(*) AS n FROM jobs").get().n,
          pending:       db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE notified = 0 AND filter_reason IS NULL").get().n,
          unnotified:    db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE notified = 0").get().n,
          filtered:      db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE filter_reason IS NOT NULL").get().n,
          alreadySent:   db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE notified = 1").get().n,
          byFilter:      db.prepare("SELECT filter_reason AS reason, COUNT(*) AS n FROM jobs WHERE filter_reason IS NOT NULL GROUP BY filter_reason ORDER BY n DESC LIMIT 10").all(),
          recentRuns:    db.prepare("SELECT ran_at AS ranAt, source, search_id AS searchId, results_found AS fetched, new_jobs AS news FROM run_log ORDER BY id DESC LIMIT 5").all(),
          // Most-recent per-source tally: how many distinct runs returned 0 in the last 24h.
          silentSources: db.prepare(`
            SELECT r.source AS source, COUNT(*) AS emptyRuns
            FROM run_log r
            WHERE r.ran_at >= datetime('now', '-1 day')
              AND r.results_found = 0
            GROUP BY r.source
            ORDER BY emptyRuns DESC
            LIMIT 12
          `).all(),
        };
        const lastNewJob = db.prepare("SELECT found_at, source, title FROM jobs WHERE notified = 0 AND filter_reason IS NULL ORDER BY found_at DESC LIMIT 1").get();
        const diagnosis = {
          ok: true,
          botRunning: status.state === 'running',
          botManagedBy: status.managedBy,
          discord: {
            botConfigured:   hasDiscordBotConfig(),
            webhookConfigured: hasDiscordWebhookConfig(),
            tokenPresent:    Boolean(appEnv.discordToken),
            channelPresent:  Boolean(appEnv.discordChannelId),
            webhookPresent:  Boolean(appEnv.discordWebhookUrl),
          },
          counts,
          lastNewJob: lastNewJob || null,
          silentSources: counts.silentSources || [],
          hints: [],
        };
        if (!diagnosis.botRunning) {
          diagnosis.hints.push('Bot is not running — start it from the dashboard or via `pm2 start job-alert-bot`.');
        }
        if (!diagnosis.discord.botConfigured && !diagnosis.discord.webhookConfigured) {
          diagnosis.hints.push('No Discord credentials found. Set DISCORD_TOKEN + DISCORD_CHANNEL_ID (bot) or DISCORD_WEBHOOK_URL in /opt/job-alert-bot/.env.');
        } else if (diagnosis.discord.tokenPresent && !diagnosis.discord.channelPresent) {
          diagnosis.hints.push('DISCORD_TOKEN is set but DISCORD_CHANNEL_ID is missing — alerts have nowhere to go.');
        }
        if (counts.pending === 0) {
          if (counts.totalJobs === 0) {
            diagnosis.hints.push('Database has zero jobs. The fetch pipeline has never produced a row — check the bot log for source failures.');
          } else if (counts.unnotified > 0) {
            diagnosis.hints.push('There are unnotified rows but all have filter_reason set. Inspect the "filtered" count by reason below.');
          } else {
            diagnosis.hints.push('Nothing left to send. Every job has been notified. Wait for the next cron tick (01:00/07:00/13:00/19:00 Europe/London) or trigger Run Once.');
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(diagnosis));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
      return;
    }

    if (pathname === '/api/bot/stop' && req.method === 'POST') {
      if (!tokenOk(req, res, token)) return;
      try {
        const result = await stopBot();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
      return;
    }

    if (pathname === '/api/bot/send-pending' && req.method === 'POST') {
      if (!tokenOk(req, res, token)) return;
      try {
        const result = runSendPending({ trigger: 'dashboard-send-pending' });
        const code = result.ok ? 200 : 409;
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
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

    if (pathname === '/api/job-preview' && req.method === 'GET') {
      if (!tokenOk(req, res, token)) return;
      const title = url.searchParams.get('title') ?? '';
      const company = url.searchParams.get('company') ?? '';
      const source = url.searchParams.get('source') ?? '';
      if (!title || !source) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Missing title or source' }));
        return;
      }
      try {
        const preview = getJobPreview(title, company, source);
        if (!preview) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'Job not found in database' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(preview));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    if (pathname === '/api/data/all') {
      try {
        const sinceId = Number(url.searchParams.get('since') || 0);
        if (sinceId > 0) {
          const newRows = getJobsSinceId(sinceId).map(rowFromDbJob);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ delta: true, maxId: getMaxJobsId(), rows: newRows }));
          return;
        }
        const data = getAllJobsAggregate();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      } catch (e) {
        res.writeHead(500); res.end(e.message);
      }
      return;
    }

    if (pathname === '/api/summary') {
      try {
        const summary = getAllJobsSummary();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(summary));
      } catch (e) {
        res.writeHead(500); res.end(e.message);
      }
      return;
    }

    if (pathname === '/api/data') {
      const file = url.searchParams.get('file');
      if (!file || file.includes('..') || !file.endsWith('.csv') || file.startsWith('.') || file.includes('/') || file.includes('\\')) {
        res.writeHead(400); res.end('Bad file param'); return;
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
          const data = getCsvAggregate(path.join(RUNS_DIR, f), f);
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
