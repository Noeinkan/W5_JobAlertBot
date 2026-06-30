import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, execFile } from 'child_process';
import fs from 'fs';
import { randomUUID } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..', '..');

const PM2_APP_NAME = process.env.PM2_APP_NAME || 'job-alert-bot';

// PM2 availability heuristic: works on most prod boxes where pm2 is on PATH.
let pm2Available = null;
function probePm2() {
  if (pm2Available !== null) return pm2Available;
  return new Promise(resolve => {
    execFile('pm2', ['--version'], { timeout: 2000 }, (err) => {
      pm2Available = !err;
      resolve(pm2Available);
    });
  });
}

let botProc   = null;
let botStatus = { state: 'idle', mode: '', startedAt: null, exitCode: null, managedBy: '' };
const sseClients = new Set();

export function pushSSE(obj) {
  const payload = `data: ${JSON.stringify(obj)}\n\n`;
  for (const r of sseClients) r.write(payload);
}

function setStatus(patch) {
  botStatus = { ...botStatus, ...patch };
  pushSSE({ type: 'status', status: botStatus });
}

// Run a `pm2 ...` command and capture stdout/stderr. Resolves with { code, stdout, stderr }.
function runPm2(args, { timeoutMs = 15000 } = {}) {
  return new Promise(resolve => {
    execFile('pm2', args, { cwd: projectRoot, timeout: timeoutMs }, (err, stdout, stderr) => {
      resolve({
        code: err ? (err.code ?? 1) : 0,
        stdout: stdout ? stdout.toString() : '',
        stderr: stderr ? stderr.toString() : '',
      });
    });
  });
}

// Poll PM2's view of the app and reflect it into botStatus.
async function refreshPm2Status() {
  const { code, stdout } = await runPm2(['jlist', '--json', '--no-color']);
  if (code !== 0) return;
  let parsed;
  try { parsed = JSON.parse(stdout); } catch { return; }
  const entry = Array.isArray(parsed) ? parsed.find(p => p.name === PM2_APP_NAME) : null;
  if (!entry) {
    setStatus({ state: 'stopped', managedBy: 'pm2' });
    return;
  }
  const pm2Status = entry.pm2_env?.status ?? 'unknown';
  const mapped = pm2Status === 'online' ? 'running'
    : pm2Status === 'stopping' ? 'stopping'
    : pm2Status === 'stopped' ? 'stopped'
    : pm2Status === 'errored' ? 'error'
    : pm2Status === 'launching' ? 'starting'
    : 'idle';
  setStatus({
    state: mapped,
    managedBy: 'pm2',
    mode: botStatus.mode || 'daemon',
    exitCode: entry.pm2_env?.exit_code ?? null,
  });
}

// PM2 path — single source of truth on prod.
async function startViaPm2(mode) {
  const isOnce = mode === 'once';
  if (isOnce) {
    // One-shot: start a transient copy with a different name so it doesn't collide
    // with the persistent daemon. PM2 will exit it when the script exits.
    const tmpName = `${PM2_APP_NAME}-oneshot-${Date.now()}`;
    await runPm2([
      'start', 'src/index.js',
      '--name', tmpName,
      '--interpreter', 'node',
      '--node-args', '--enable-source-maps',
      '--', '--once',
    ]);
    setStatus({ state: 'running', mode: 'once', startedAt: new Date().toISOString(), managedBy: 'pm2' });
    // Poll once to capture exit when the one-shot ends.
    const pollUntil = Date.now() + 5 * 60_000;
    const tick = async () => {
      if (Date.now() > pollUntil) return;
      await refreshPm2Status();
      const { code, stdout } = await runPm2(['jlist', '--json', '--no-color']);
      try {
        const list = JSON.parse(stdout);
        const still = Array.isArray(list) && list.find(p => p.name === tmpName);
        if (!still) {
          setStatus({ state: 'done', exitCode: 0 });
          // Best-effort cleanup of the transient entry.
          runPm2(['delete', tmpName]).catch(() => {});
          return;
        }
      } catch { /* ignore */ }
      setTimeout(tick, 2000);
    };
    setTimeout(tick, 2000);
    return true;
  }

  // Daemon: make sure it's running under PM2.
  await runPm2(['start', 'ecosystem.config.cjs', '--only', PM2_APP_NAME, '--env', 'production']);
  // `start` is idempotent-ish in PM2: if it's already running it errors harmlessly.
  const r = await runPm2(['list']);
  setStatus({ state: 'running', mode: 'daemon', startedAt: new Date().toISOString(), managedBy: 'pm2' });
  void r;
  return true;
}

// Dev-only fallback: keep the legacy child_process.spawn behaviour when PM2 isn't installed.
async function startViaSpawn(mode) {
  if (botProc) return false;
  const isOnce = mode === 'once';
  botProc = spawn('node', ['src/index.js'], {
    cwd:  projectRoot,
    env:  { ...process.env, RUN_ONCE: isOnce ? 'true' : '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  setStatus({ state: 'running', mode, startedAt: new Date().toISOString(), managedBy: 'spawn' });
  const onData = chunk => pushSSE({ type: 'log', line: chunk.toString() });
  botProc.stdout.on('data', onData);
  botProc.stderr.on('data', onData);
  botProc.on('close', code => {
    botProc = null;
    setStatus({ state: code === 0 ? 'done' : 'error', exitCode: code });
  });
  return true;
}

export async function startBot(mode = 'daemon') {
  if (botProc) return { ok: false, reason: 'already_running' };
  const hasPm2 = await probePm2();
  if (hasPm2) {
    const ok = await startViaPm2(mode);
    return { ok, managedBy: 'pm2' };
  }
  const ok = await startViaSpawn(mode);
  return { ok, managedBy: 'spawn' };
}

export async function stopBot() {
  if (botProc) {
    botProc.kill('SIGTERM');
    return { ok: true, managedBy: 'spawn' };
  }
  const hasPm2 = await probePm2();
  if (hasPm2) {
    await runPm2(['stop', PM2_APP_NAME]);
    setStatus({ state: 'stopped', managedBy: 'pm2' });
    return { ok: true, managedBy: 'pm2' };
  }
  return { ok: false, reason: 'not_running' };
}

export function getBotStatus() {
  return botStatus;
}

/**
 * Spawn `scripts/send-pending.js` once and stream its stdout lines via SSE.
 * Returns a small wrapper compatible with `botProc` semantics.
 */
export function runSendPending({ trigger = 'dashboard' } = {}) {
  if (botProc) return { ok: false, reason: 'bot_running' };
  const child = spawn('node', ['scripts/send-pending.js', '--trigger', trigger], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Pretend this is the bot's "send-pending" task so the dashboard can label it.
  setStatus({ state: 'running', mode: 'send-pending', startedAt: new Date().toISOString(), managedBy: 'spawn' });
  const onData = chunk => pushSSE({ type: 'log', line: chunk.toString() });
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('close', code => {
    botProc = null;
    setStatus({ state: code === 0 ? 'done' : 'error', mode: 'send-pending', exitCode: code });
  });
  // Mirror just enough of the botProc interface for the kill() path if hit mid-flight.
  botProc = { kill: () => child.kill('SIGTERM') };
  return { ok: true, pid: child.pid, jobId: randomUUID() };
}

// Backwards-compat: server.js imports getBotProc() to gate /api/bot/stop
// and "already running" detection. With PM2 we don't have a child handle,
// so we synthesize a small wrapper with a .kill() that delegates to PM2.
export function getBotProc() {
  if (botProc) return botProc;
  return {
    kill: async () => {
      const r = await stopBot();
      return r.ok;
    },
  };
}

export function getSseClients() {
  return sseClients;
}

// Tail the bot's log file and push new bytes to all SSE clients. Used when the
// bot is PM2-managed (so its stdout isn't a child of this process) and the
// dashboard's Bot log panel would otherwise stay empty.
const PM2_LOG_TAIL_INTERVAL_MS = 1000;
const PM2_LOG_TAIL_MAX_CHUNK = 64 * 1024;
let pm2LogTail = null; // { path, timer, offset }

export function startPm2LogTail(logPath) {
  stopPm2LogTail();
  if (!logPath) return;
  const initialOffset = (() => {
    try { return fs.statSync(logPath).size; } catch { return 0; }
  })();
  pm2LogTail = { path: logPath, timer: null, offset: initialOffset };
  const tick = () => {
    const state = pm2LogTail;
    if (!state) return;
    let size;
    try { size = fs.statSync(state.path).size; }
    catch { state.timer = setTimeout(tick, PM2_LOG_TAIL_INTERVAL_MS); return; }
    // Log rotated/truncated: reset and start from the top of the new file.
    if (size < state.offset) state.offset = 0;
    if (size === state.offset) {
      state.timer = setTimeout(tick, PM2_LOG_TAIL_INTERVAL_MS);
      return;
    }
    const end = Math.min(size, state.offset + PM2_LOG_TAIL_MAX_CHUNK);
    const stream = fs.createReadStream(state.path, { start: state.offset, end: end - 1 });
    stream.on('data', chunk => {
      pushSSE({ type: 'log', line: chunk.toString() });
    });
    stream.on('close', () => {
      state.offset = end;
      if (size > end) {
        // More to read this tick — schedule another pass immediately.
        state.timer = setTimeout(tick, 0);
      } else {
        state.timer = setTimeout(tick, PM2_LOG_TAIL_INTERVAL_MS);
      }
    });
    stream.on('error', () => {
      state.timer = setTimeout(tick, PM2_LOG_TAIL_INTERVAL_MS);
    });
  };
  pm2LogTail.timer = setTimeout(tick, PM2_LOG_TAIL_INTERVAL_MS);
}

export function stopPm2LogTail() {
  if (pm2LogTail?.timer) clearTimeout(pm2LogTail.timer);
  pm2LogTail = null;
}

// Status must be read fresh on each /api/bot/status call when PM2 is in use.
export async function readLiveStatus() {
  const hasPm2 = await probePm2();
  if (hasPm2) {
    await refreshPm2Status();
  }
  return botStatus;
}
