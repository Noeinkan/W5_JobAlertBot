// Profile fit (Red/Amber/Green) from data/profile.json — personal / CV-aligned signals vs generic IT ads.
import fs from 'node:fs';
import path from 'node:path';

let cached = null;
let cachedPath = null;

function compilePatternEntry(entry, kind) {
  let re;
  try {
    re = new RegExp(entry.pattern, 'i');
  } catch (e) {
    throw new Error(`Invalid profile regex (${kind} "${entry.label ?? entry.pattern}"): ${e.message}`);
  }
  const unless = Array.isArray(entry.unless)
    ? entry.unless.map((p, i) => {
        try {
          return new RegExp(p, 'i');
        } catch (err) {
          throw new Error(`Invalid unless[${i}] in "${entry.label ?? kind}": ${err.message}`);
        }
      })
    : [];
  return { re, weight: Number(entry.weight) || 0, label: String(entry.label ?? entry.pattern), unless };
}

/**
 * @param {string} profilePath - absolute or cwd-relative path to profile.json
 */
export function loadProfileFitConfig(profilePath) {
  const resolved = path.resolve(profilePath);
  if (cached && cachedPath === resolved) {
    return cached;
  }

  if (!fs.existsSync(resolved)) {
    throw new Error(`Profile fit config not found: ${resolved}`);
  }

  const raw = fs.readFileSync(resolved, 'utf8');
  const data = JSON.parse(raw);

  const greenThreshold = Number(data.greenThreshold ?? 10);
  const amberThreshold = Number(data.amberThreshold ?? 4);

  const positivePatterns = (data.positivePatterns ?? []).map((e) => compilePatternEntry(e, 'positive'));
  const negativePatterns = (data.negativePatterns ?? []).map((e) => compilePatternEntry(e, 'negative'));
  const titleNegativePatterns = (data.titleNegativePatterns ?? []).map((e) => compilePatternEntry(e, 'titleNegative'));

  cached = {
    greenThreshold,
    amberThreshold,
    positivePatterns,
    negativePatterns,
    titleNegativePatterns,
  };
  cachedPath = resolved;
  return cached;
}

export function clearProfileFitCache() {
  cached = null;
  cachedPath = null;
}

/**
 * @param {object} job - normalized job with title, description
 * @param {string} profilePath
 * @returns {{ rating: string, score: number, reason: string|null, matches: object }}
 */
export function scoreProfileFit(job, profilePath) {
  const cfg = loadProfileFitConfig(profilePath);
  const title = (job.title || '').trim();
  const desc = (job.description || '').trim();
  const fullText = `${title}\n${desc}`;

  const positiveLabels = [];
  let posSum = 0;
  for (const { re, weight, label } of cfg.positivePatterns) {
    if (re.test(fullText)) {
      posSum += weight;
      positiveLabels.push(label);
    }
  }

  const negativeLabels = [];
  let negSum = 0;
  for (const { re, weight, label, unless } of cfg.negativePatterns) {
    if (!re.test(fullText)) continue;
    const rescued = unless.some((u) => u.test(fullText));
    if (rescued) continue;
    negSum += weight;
    negativeLabels.push(label);
  }

  const titleNegLabels = [];
  let titleNegSum = 0;
  for (const { re, weight, label } of cfg.titleNegativePatterns) {
    if (re.test(title)) {
      titleNegSum += weight;
      titleNegLabels.push(label);
    }
  }

  const hasSignal =
    positiveLabels.length > 0 || negativeLabels.length > 0 || titleNegLabels.length > 0;

  if (!hasSignal) {
    return {
      rating: 'Amber',
      score: 0,
      reason: null,
      matches: { positive: [], negative: [], titleNegative: [] },
    };
  }

  const total = Math.round(posSum + negSum + titleNegSum);
  const rating =
    total >= cfg.greenThreshold ? 'Green' : total >= cfg.amberThreshold ? 'Amber' : 'Red';

  const parts = [];
  if (positiveLabels.length > 0) parts.push(`Match: ${positiveLabels.slice(0, 4).join(', ')}`);
  if (negativeLabels.length > 0) parts.push(`Downrank: ${negativeLabels.join(', ')}`);
  if (titleNegLabels.length > 0) parts.push(`Title: ${titleNegLabels.join(', ')}`);
  const reason = parts.length > 0 ? parts.join(' · ') : null;

  return {
    rating,
    score: total,
    reason,
    matches: {
      positive: positiveLabels,
      negative: negativeLabels,
      titleNegative: titleNegLabels,
    },
  };
}
