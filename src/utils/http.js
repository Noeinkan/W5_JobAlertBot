import { env } from '../config.js';
import { logger } from './logger.js';

function isRetryableStatus(status) {
  return [408, 425, 429, 500, 502, 503, 504].includes(status);
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function isRetryableError(error) {
  const status = error?.response?.status;

  if (typeof status === 'number') {
    return isRetryableStatus(status);
  }

  return Boolean(error?.code && ['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED'].includes(error.code));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry(operation, meta = {}) {
  const attempts = Math.max(1, env.httpMaxRetries);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const retryable = isRetryableError(error);
      const lastAttempt = attempt === attempts;

      logger.warn('HTTP request failed', {
        ...meta,
        attempt,
        attempts,
        retryable,
        message: getErrorMessage(error),
        status: error?.response?.status ?? null,
      });

      if (!retryable || lastAttempt) {
        throw error;
      }

      await delay(env.httpRetryDelayMs * attempt);
    }
  }

  throw new Error('Retry policy exhausted unexpectedly.');
}
