/**
 * Dashboard server — browse run CSVs in the browser.
 * Usage: node src/dashboard.js [--port 3099]
 */
import 'dotenv/config';
import { createDashboardServer } from './dashboard/server.js';

const portArg = process.argv.indexOf('--port');
const PORT = portArg !== -1 ? parseInt(process.argv[portArg + 1], 10) : 3099;
const HOST      = process.env.DASHBOARD_HOST      || '127.0.0.1';
const TOKEN     = process.env.DASHBOARD_TOKEN     || '';
const BASE_PATH = (process.env.DASHBOARD_BASE_PATH || '').replace(/\/$/, '');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '0:0:0:0:0:0:0:1']);
if (!LOOPBACK_HOSTS.has(HOST) && !TOKEN) {
  console.error(`Refusing to bind dashboard to ${HOST} without DASHBOARD_TOKEN. Set a token or keep DASHBOARD_HOST on loopback.`);
  process.exit(1);
}

const server = createDashboardServer({
  port: PORT,
  host: HOST,
  token: TOKEN,
  basePath: BASE_PATH,
});

server.listen(PORT, HOST, () => {
  const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`Dashboard running → http://${displayHost}:${PORT}`);
  if (TOKEN) console.log('Dashboard token protection: enabled');
  if (!LOOPBACK_HOSTS.has(HOST)) console.log(`Dashboard bound to non-loopback host ${HOST}; token required on bot-control endpoints.`);
});
