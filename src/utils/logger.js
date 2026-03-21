import fs from 'node:fs';
import path from 'node:path';
import { appConfig, env } from '../config.js';

fs.mkdirSync(path.dirname(appConfig.logFilePath), { recursive: true });

const levels = {
  error: 0,
  warn: 1,
  info: 2,
};

function formatTimestamp(date = new Date()) {
  return date.toISOString();
}

function shouldLog(level) {
  const currentLevel = levels[env.logLevel] ?? levels.info;
  return (levels[level] ?? levels.info) <= currentLevel;
}

function write(level, message, meta) {
  if (!shouldLog(level)) {
    return;
  }

  const suffix = meta ? ` ${JSON.stringify(meta)}` : '';
  const line = `[${formatTimestamp()}] ${level.toUpperCase()} ${message}${suffix}`;
  const consoleMethod = level === 'info' ? 'log' : level;

  console[consoleMethod](line);
  fs.appendFileSync(appConfig.logFilePath, `${line}\n`, 'utf8');
}

export const logger = {
  info(message, meta) {
    write('info', message, meta);
  },
  warn(message, meta) {
    write('warn', message, meta);
  },
  error(message, meta) {
    write('error', message, meta);
  },
};
