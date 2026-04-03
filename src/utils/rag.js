// RAG (Red / Amber / Green) job quality scoring matrix.
// Evaluates title + description against weighted keyword indicators.
// Returns { rating: 'Green'|'Amber'|'Red', score: number, reason: string|null }

const TITLE_WEIGHTS = [
  { pattern: /\bassociate director\b/i, score: 12 },
  { pattern: /\bhead of\b/i, score: 10 },
  { pattern: /\bdirector\b/i, score: 10 },
  { pattern: /\bvp\b|\bvice president\b/i, score: 10 },
  { pattern: /\bprincipal\b/i, score: 9 },
  { pattern: /\blead\b/i, score: 7 },
  { pattern: /\bsenior\b/i, score: 6 },
  { pattern: /\bmanager\b/i, score: 5 },
];

const DOMAIN_WEIGHTS = [
  { pattern: /digital construction/i, score: 6 },
  { pattern: /information management/i, score: 6 },
  { pattern: /digital delivery/i, score: 6 },
  { pattern: /digital engineering/i, score: 6 },
  { pattern: /iso\s*19650/i, score: 6 },
  { pattern: /\bcde\b|common data environment/i, score: 5 },
  { pattern: /digital twin/i, score: 5 },
  { pattern: /\bbim\b/i, score: 5 },
  { pattern: /\bvdc\b/i, score: 4 },
  { pattern: /\baec\b/i, score: 3 },
  { pattern: /\brevit\b/i, score: 3 },
  { pattern: /\bnavisworks\b/i, score: 3 },
  { pattern: /point cloud|scan to bim/i, score: 3 },
  { pattern: /\binfrastructure\b/i, score: 2 },
  { pattern: /\bconstruction\b/i, score: 2 },
];

const DESC_SENIORITY_WEIGHTS = [
  { pattern: /\bp&l\b/i, score: 6 },
  { pattern: /board level/i, score: 6 },
  { pattern: /thought leadership/i, score: 4 },
  { pattern: /line management/i, score: 5 },
  { pattern: /budget responsibility/i, score: 5 },
  { pattern: /\b(10|12|15)\+?\s*years?\b/i, score: 5 },
  { pattern: /8\+?\s*years?\b/i, score: 4 },
  { pattern: /client.facing/i, score: 3 },
  { pattern: /\bstrategy\b/i, score: 3 },
];

const NEGATIVE_WEIGHTS = [
  { pattern: /\bjunior\b/i, score: -10 },
  { pattern: /\bgraduate\b/i, score: -10 },
  { pattern: /\bintern(ship)?\b/i, score: -10 },
  { pattern: /\bapprentice\b/i, score: -10 },
  { pattern: /\btrainee\b/i, score: -10 },
  { pattern: /entry.level/i, score: -10 },
  { pattern: /\bdocument controller\b/i, score: -8 },
  { pattern: /\bcoordinator\b/i, score: -5 },
  { pattern: /\bmodell?er\b/i, score: -5 },
  { pattern: /\btechnician\b/i, score: -5 },
  { pattern: /\bassistant\b/i, score: -5 },
];

// Non-AEC roles — checked against title only, return Red immediately
const NON_AEC_BLOCKERS = [
  /\bnurs(e|ing)\b/i,
  /\bsolicitor\b|\blawyer\b/i,
  /\baccountant\b/i,
  /\bpharmacist\b/i,
  /estate\s*agent/i,
  /\bmortgage\b/i,
  /\binsurance\s*(advisor|broker|agent)\b/i,
  /care\s*(assistant|worker|home)/i,
  /teaching\s*assistant/i,
  /\bhr\s*(manager|advisor|officer|director)\b/i,
  /recruitment\s*consultant/i,
  /\bwarehouse\b/i,
  /\bdriver\b/i,
  /\bchef\b|\bcook\b/i,
];

const GREEN_THRESHOLD = 15;
const AMBER_THRESHOLD = 5;

export function scoreJob(job) {
  const title = (job.title || '').toLowerCase();
  const desc = (job.description || '').toLowerCase();
  const fullText = title + ' ' + desc;

  for (const blocker of NON_AEC_BLOCKERS) {
    if (blocker.test(title)) {
      return { rating: 'Red', score: -99, reason: 'Non-AEC role' };
    }
  }

  let score = 0;
  const matchedLabels = [];

  for (const { pattern, score: w } of TITLE_WEIGHTS) {
    if (pattern.test(title)) {
      score += w;
      matchedLabels.push(pattern.source.replace(/\\b|\\s\*/g, '').replace(/\|.+/, '').replace(/\\/g, ''));
    }
  }

  for (const { pattern, score: w } of DOMAIN_WEIGHTS) {
    if (pattern.test(fullText)) score += w;
  }

  for (const { pattern, score: w } of DESC_SENIORITY_WEIGHTS) {
    if (pattern.test(fullText)) score += w;
  }

  for (const { pattern, score: w } of NEGATIVE_WEIGHTS) {
    if (pattern.test(title)) score += w;
  }

  const rating = score >= GREEN_THRESHOLD ? 'Green' : score >= AMBER_THRESHOLD ? 'Amber' : 'Red';
  const reason = matchedLabels.length > 0 ? matchedLabels.slice(0, 3).join(', ') : null;

  return { rating, score, reason };
}
