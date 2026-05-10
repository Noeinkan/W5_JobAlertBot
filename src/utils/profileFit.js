// Profile fit (Red/Amber/Green) from data/profile.json — personal / CV-aligned signals vs generic IT ads.
import fs from 'node:fs';
import path from 'node:path';

let cached = null;
let cachedPath = null;

/**
 * Build regex alternation from alias list.
 * @param {string[]} parts
 */
function aliasToPattern(parts) {
  if (!parts.length) return '';
  return `(?:${parts.map((p) => `(?:${p})`).join('|')})`;
}

function resolvePatternString(entry, aliases) {
  if (entry.aliasOf && entry.pattern) {
    throw new Error(`Pattern "${entry.label ?? entry.aliasOf}" cannot set both pattern and aliasOf`);
  }
  if (entry.aliasOf) {
    const parts = aliases[entry.aliasOf];
    if (!Array.isArray(parts) || parts.length === 0) {
      throw new Error(`Unknown or empty aliasOf: "${entry.aliasOf}"`);
    }
    return aliasToPattern(parts);
  }
  return entry.pattern ?? '';
}

function compilePatternEntry(entry, kind, aliases) {
  const patternStr = resolvePatternString(entry, aliases);
  if (!patternStr) {
    throw new Error(`Missing pattern or aliasOf for ${kind} "${entry.label ?? kind}"`);
  }
  let re;
  try {
    re = new RegExp(patternStr, 'i');
  } catch (e) {
    throw new Error(`Invalid profile regex (${kind} "${entry.label ?? patternStr}"): ${e.message}`);
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
  const dimension = String(entry.dimension ?? 'general');
  const tier = entry.tier === 'required' ? 'required' : 'preferred';
  return {
    re,
    weight: Number(entry.weight) || 0,
    label: String(entry.label ?? patternStr),
    unless,
    dimension,
    tier,
  };
}

function normalizeAggregation(raw) {
  const a = raw && typeof raw === 'object' ? raw : {};
  const cap = a.capPerDimension;
  const capPerDimension = cap == null || cap === '' ? Number.POSITIVE_INFINITY : Number(cap);
  const veto = a.vetoNegativeTotalBelow;
  const vetoNegativeTotalBelow =
    veto == null || veto === '' ? null : Number(veto);
  const req = Array.isArray(a.requireAtLeastOnePositiveInDimensions)
    ? a.requireAtLeastOnePositiveInDimensions.map((d) => String(d))
    : [];
  const missingRating = String(a.missingRequiredDimensionsRating ?? 'Amber');
  const missingOk = missingRating === 'Red' || missingRating === 'Amber' ? missingRating : 'Amber';
  return {
    mode: String(a.mode ?? 'sum'),
    capPerDimension,
    vetoNegativeTotalBelow,
    requireAtLeastOnePositiveInDimensions: req,
    missingRequiredDimensionsRating: missingOk,
  };
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

  const aliases = data.aliases && typeof data.aliases === 'object' ? data.aliases : {};
  const greenThreshold = Number(data.greenThreshold ?? 10);
  const amberThreshold = Number(data.amberThreshold ?? 4);
  const northStar = data.northStar != null ? String(data.northStar) : '';
  const dimensionsMeta =
    data.dimensions && typeof data.dimensions === 'object' ? data.dimensions : {};

  const positivePatterns = (data.positivePatterns ?? []).map((e) =>
    compilePatternEntry(e, 'positive', aliases),
  );
  const titlePositivePatterns = (data.titlePositivePatterns ?? []).map((e) =>
    compilePatternEntry(e, 'titlePositive', aliases),
  );
  const negativePatterns = (data.negativePatterns ?? []).map((e) =>
    compilePatternEntry(e, 'negative', aliases),
  );
  const titleNegativePatterns = (data.titleNegativePatterns ?? []).map((e) =>
    compilePatternEntry(e, 'titleNegative', aliases),
  );

  const aggregation = normalizeAggregation(data.aggregation);

  cached = {
    version: data.version ?? 1,
    greenThreshold,
    amberThreshold,
    northStar,
    dimensionsMeta,
    aggregation,
    positivePatterns,
    titlePositivePatterns,
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

function sumDimensionMap(dimRaw, capPerDimension) {
  let total = 0;
  const cappedByDim = {};
  for (const [dim, raw] of Object.entries(dimRaw)) {
    const capped = Math.min(raw, capPerDimension);
    cappedByDim[dim] = capped;
    total += capped;
  }
  return { total: Math.round(total), cappedByDim };
}

function ratingFromThresholds(score, greenThreshold, amberThreshold) {
  if (score >= greenThreshold) return 'Green';
  if (score >= amberThreshold) return 'Amber';
  return 'Red';
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

  /** @type {Record<string, number>} */
  const dimRawPos = {};

  const positiveLabels = [];
  for (const { re, weight, label, dimension } of cfg.positivePatterns) {
    if (re.test(fullText)) {
      dimRawPos[dimension] = (dimRawPos[dimension] ?? 0) + weight;
      positiveLabels.push(label);
    }
  }

  const titlePositiveLabels = [];
  for (const { re, weight, label, dimension } of cfg.titlePositivePatterns) {
    if (re.test(title)) {
      dimRawPos[dimension] = (dimRawPos[dimension] ?? 0) + weight;
      titlePositiveLabels.push(label);
    }
  }

  /** Dimensions that had at least one body or title-positive hit */
  const dimensionsWithPositiveHit = new Set();
  for (const { re, dimension } of cfg.positivePatterns) {
    if (re.test(fullText)) dimensionsWithPositiveHit.add(dimension);
  }
  for (const { re, dimension } of cfg.titlePositivePatterns) {
    if (re.test(title)) dimensionsWithPositiveHit.add(dimension);
  }

  const cap = cfg.aggregation.capPerDimension;
  const { total: adjustedPosSum, cappedByDim } = sumDimensionMap(dimRawPos, cap);

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

  const negCombined = negSum + titleNegSum;

  const hasSignal =
    positiveLabels.length > 0 ||
    titlePositiveLabels.length > 0 ||
    negativeLabels.length > 0 ||
    titleNegLabels.length > 0;

  const matchesBase = {
    northStar: cfg.northStar || undefined,
    positive: positiveLabels,
    titlePositive: titlePositiveLabels,
    negative: negativeLabels,
    titleNegative: titleNegLabels,
    dimensionScores: cappedByDim,
  };

  if (!hasSignal) {
    return {
      rating: 'Amber',
      score: 0,
      reason: null,
      matches: matchesBase,
    };
  }

  let vetoReason = null;
  const vetoThreshold = cfg.aggregation.vetoNegativeTotalBelow;
  if (
    vetoThreshold != null &&
    Number.isFinite(vetoThreshold) &&
    negCombined <= vetoThreshold
  ) {
    vetoReason = `Veto: negatives ${negCombined} ≤ ${vetoThreshold}`;
  }

  const total = Math.round(adjustedPosSum + negCombined);
  let rating = ratingFromThresholds(total, cfg.greenThreshold, cfg.amberThreshold);

  if (vetoReason) {
    rating = 'Red';
  }

  const reqDims = cfg.aggregation.requireAtLeastOnePositiveInDimensions;
  if (
    rating === 'Green' &&
    reqDims.length > 0 &&
    !vetoReason
  ) {
    const missing = reqDims.filter((d) => !dimensionsWithPositiveHit.has(d));
    if (missing.length > 0) {
      rating = cfg.aggregation.missingRequiredDimensionsRating;
      vetoReason = (vetoReason ? vetoReason + ' · ' : '') + `Gate: missing ${missing.join(', ')}`;
    }
  }

  const parts = [];
  if (positiveLabels.length > 0) parts.push(`Match: ${positiveLabels.slice(0, 4).join(', ')}`);
  if (titlePositiveLabels.length > 0) parts.push(`Title +: ${titlePositiveLabels.slice(0, 3).join(', ')}`);
  if (negativeLabels.length > 0) parts.push(`Downrank: ${negativeLabels.join(', ')}`);
  if (titleNegLabels.length > 0) parts.push(`Title −: ${titleNegLabels.join(', ')}`);
  if (vetoReason) parts.push(vetoReason);
  const reason = parts.length > 0 ? parts.join(' · ') : null;

  return {
    rating,
    score: total,
    reason,
    matches: matchesBase,
  };
}
