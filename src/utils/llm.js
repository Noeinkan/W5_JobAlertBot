import axios from 'axios';
import { env } from '../config.js';
import { logger } from './logger.js';

const DESCRIPTION_MAX_CHARS = 1500;
const VALID_RATINGS = new Set(['Green', 'Amber', 'Red']);

function buildPrompt(job, { regexRating, regexScore }) {
  const title = String(job.title ?? '').slice(0, 200);
  const company = String(job.company ?? '').slice(0, 120);
  const location = String(job.location ?? '').slice(0, 120);
  const description = String(job.description ?? '').slice(0, DESCRIPTION_MAX_CHARS);

  return [
    'You are a hiring filter for a senior AEC (Architecture, Engineering, Construction) digital construction / BIM / information management specialist based in the UK.',
    'Given a job posting, return a single JSON object rating its fit for that specialist.',
    '',
    'Rating rubric:',
    '- "Green": senior/lead/head/director role clearly in AEC digital construction, BIM, information management, digital delivery, digital engineering, CDE, ISO 19650, or digital twin space.',
    '- "Amber": adjacent or borderline — e.g. mid-level AEC digital role, or senior role where AEC relevance is ambiguous.',
    '- "Red": not a fit — junior/coordinator/modeller/technician/assistant, non-AEC sectors (pure SaaS, fintech, data engineering, healthcare nursing, legal, etc.).',
    '',
    'A regex pre-filter has already produced an initial verdict; use it as context but do not blindly accept it — re-read the description and adjust if the title is misleading (e.g. "Senior" headline but mid-level body, or implicit AEC seniority not captured by keywords).',
    '',
    `Regex verdict: ${regexRating ?? 'unknown'} (score ${regexScore ?? 'n/a'})`,
    '',
    `Title: ${title}`,
    `Company: ${company}`,
    `Location: ${location}`,
    `Description: ${description}`,
    '',
    'Respond with ONLY this JSON shape, no prose:',
    '{"rating":"Green|Amber|Red","score":0-30,"reason":"one short sentence","fitSummary":"one short sentence on the actual role fit"}',
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

    logger.debug('LLM analysis succeeded', {
      source: job.source,
      title: job.title,
      regexRating,
      llmRating: validated.rating,
      llmScore: validated.score,
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
    logger.debug('LLM analysis failed', {
      source: job.source,
      latencyMs,
      error: errCode,
      message: error.message,
    });
    return { ok: false, error: errCode, latencyMs };
  }
}
