#!/usr/bin/env node
/**
 * One-shot Discord delivery of currently pending jobs (no fetch cycle).
 * Used by the dashboard "Send pending now" button and as a manual CLI for ops.
 *
 *  node scripts/send-pending.js                  # trigger=manual
 *  node scripts/send-pending.js --trigger cron   # custom trigger label
 */
import { notifyPending } from '../src/notify-pending.js';

const args = process.argv.slice(2);
let trigger = 'manual-send-pending';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--trigger') trigger = args[++i] || trigger;
  else if (args[i].startsWith('--trigger=')) trigger = args[i].slice('--trigger='.length) || trigger;
}

try {
  const result = await notifyPending({ trigger });
  process.stdout.write(JSON.stringify({ ok: !result.error, ...result }) + '\n');
  process.exit(result.error ? 1 : 0);
} catch (err) {
  process.stderr.write('send-pending: ' + (err && err.message ? err.message : String(err)) + '\n');
  process.exit(2);
}
