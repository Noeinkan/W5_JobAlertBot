import axios from 'axios';
import { env } from '../config.js';
import { logger } from './logger.js';

const DESCRIPTION_MAX_CHARS = 600;
const VALID_RATINGS = new Set(['Green', 'Amber', 'Red']);

function buildPrompt(job, { regexRating, regexScore }) {
  const title = String(job.title ?? '').slice(0, 160);
  const company = String(job.company ?? '').slice(0, 100);
  const description = String(job.description ?? '').slice(0, DESCRIPTION_MAX_CHARS);

  return [
    'Rate this job for a senior UK AEC digital construction / BIM / information management specialist.',
    'Green = clearly senior AEC digital role. Amber = borderline. Red = junior, wrong sector, or non-AEC.',
    `Regex pre-filter said: ${regexRating ?? '?'} (score ${regexScore ?? '?'}). Re-read and adjust if needed.`,
    '',
    `Title: ${title}`,
    `Company: ${company}`,
    `Description: ${description}`,
    '',
    'Reply with ONLY: {"rating":"Green|Amber|Red","score":0-30,"reason":"<8 words>","fitSummary":"<8 words>"}',
  ].join('\n');
}

function parseAndValidate(rawText) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (!VALID_RATINGS.has(parsed.rating)) return null;
  const score = Number(parsed.score);
  if (!Number.isFinite(score)) return null;
  return {
    rating: parsed.rating,
    score: Math.round(score),
    reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 500) : '',
    fitSummary: typeof parsed.fitSummary === 'string' ? parsed.fitSummary.slice(0, 500) : '',
  };
}

/**
 * Returns { ok: true, rating, score, reason, fitSummary, model, analyzedAt, latencyMs }
 *      or { ok: false, error, latencyMs }.
 * Never throws — pipeline must keep running on any failure.
 */
export async function analyzeJobWithLLM(job, { regexRating, regexScore } = {}) {
  const startedAt = Date.now();
  const prompt = buildPrompt(job, { regexRating, regexScore });

  try {
    const response = await axios.post(
      `${env.ollamaHost.replace(/\/$/, '')}/api/generate`,
      {
        model: env.ollamaModel,
        prompt,
        format: 'json',
        stream: false,
        options: {
          num_predict: env.ollamaMaxTokens,
          temperature: 0.1,
        },
      },
      { timeout: env.ollamaTimeoutMs }
    );

    const latencyMs = Date.now() - startedAt;
    const text = response?.data?.response;
    if (typeof text !== 'string') {
      logger.debug('LLM analysis: non-string response', { source: job.source, latencyMs });
      return { ok: false, error: 'parse', latencyMs };
    }

    const validated = parseAndValidate(text);
    if (!validated) {
      logger.debug('LLM analysis: parse/validation failed', {
        source: job.source,
        latencyMs,
        preview: text.slice(0, 200),
      });
      return { ok: false, error: 'parse', latencyMs };
    }

    logger.info('LLM analysis succeeded', {
      source: job.source,
      title: job.title,
      regexRating,
      llmRating: validated.rating,
      llmScore: validated.score,
      llmReason: validated.reason,
      llmFitSummary: validated.fitSummary,
      latencyMs,
    });

    return {
      ok: true,
      rating: validated.rating,
      score: validated.score,
      reason: validated.reason,
      fitSummary: validated.fitSummary,
      model: env.ollamaModel,
      analyzedAt: Date.now(),
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const errCode = error.code === 'ECONNABORTED' || /timeout/i.test(error.message ?? '')
      ? 'timeout'
      : 'http';
    logger.warn('LLM analysis failed', {
      source: job.source,
      latencyMs,
      error: errCode,
      message: error.message,
    });
    return { ok: false, error: errCode, latencyMs };
  }
}
