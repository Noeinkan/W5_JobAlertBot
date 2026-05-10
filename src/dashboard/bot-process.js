import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..', '..');

let botProc   = null;
let botStatus = { state: 'idle', mode: '', startedAt: null, exitCode: null };
const sseClients = new Set();

export function pushSSE(obj) {
  const payload = `data: ${JSON.stringify(obj)}\n\n`;
  for (const r of sseClients) r.write(payload);
}

export function startBot(mode) {
  if (botProc) return false;
  const isOnce = mode === 'once';
  botStatus = { state: 'running', mode, startedAt: new Date().toISOString(), exitCode: null };
  pushSSE({ type: 'status', status: botStatus });

  botProc = spawn('node', ['src/index.js'], {
    cwd:  projectRoot,
    env:  { ...process.env, RUN_ONCE: isOnce ? 'true' : '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const onData = chunk => pushSSE({ type: 'log', line: chunk.toString() });
  botProc.stdout.on('data', onData);
  botProc.stderr.on('data', onData);

  botProc.on('close', code => {
    botProc = null;
    botStatus = { ...botStatus, state: code === 0 ? 'done' : 'error', exitCode: code };
    pushSSE({ type: 'status', status: botStatus });
  });
  return true;
}

export function getBotStatus() {
  return botStatus;
}

export function getBotProc() {
  return botProc;
}

export function getSseClients() {
  return sseClients;
}
