// RAG (Red / Amber / Green) job quality scoring matrix.
// Evaluates title + description against weighted keyword indicators.
// Returns { rating: 'Green'|'Amber'|'Red', score: number, reason: string|null }

const TITLE_WEIGHTS = [
  { pattern: /\bassociate director\b/i, score: 12, label: 'Associate Director' },
  { pattern: /\bhead of\b/i, score: 10, label: 'Head of' },
  { pattern: /\bdirector\b/i, score: 10, label: 'Director' },
  { pattern: /\bvp\b|\bvice president\b/i, score: 10, label: 'VP' },
  { pattern: /\bprincipal\b/i, score: 9, label: 'Principal' },
  { pattern: /\blead\b/i, score: 7, label: 'Lead' },
  { pattern: /\bsenior\b/i, score: 6, label: 'Senior' },
  { pattern: /\bmanager\b/i, score: 5, label: 'Manager' },
];

const DOMAIN_WEIGHTS = [
  { pattern: /digital construction/i, score: 6, label: 'Digital Construction' },
  { pattern: /information management/i, score: 6, label: 'Information Management' },
  { pattern: /digital delivery/i, score: 6, label: 'Digital Delivery' },
  { pattern: /digital engineering/i, score: 6, label: 'Digital Engineering' },
  { pattern: /iso\s*19650/i, score: 6, label: 'ISO 19650' },
  { pattern: /\bcde\b|common data environment/i, score: 5, label: 'CDE' },
  { pattern: /digital twin/i, score: 5, label: 'Digital Twin' },
  { pattern: /\bbim\b/i, score: 5, label: 'BIM' },
  { pattern: /\bvdc\b/i, score: 4, label: 'VDC' },
  { pattern: /\baec\b/i, score: 3, label: 'AEC' },
  { pattern: /\brevit\b/i, score: 3, label: 'Revit' },
  { pattern: /\bnavisworks\b/i, score: 3, label: 'Navisworks' },
  { pattern: /point cloud|scan to bim/i, score: 3, label: 'Point Cloud/Scan to BIM' },
  { pattern: /\binfrastructure\b/i, score: 2, label: 'Infrastructure' },
  { pattern: /\bconstruction\b/i, score: 2, label: 'Construction' },
  { pattern: /\bnuclear\b/i, score: 5, label: 'Nuclear' },
  { pattern: /national grid|electricity transmission|energy grid/i, score: 4, label: 'Energy/Grid' },
  { pattern: /asset information model|asset information management/i, score: 6, label: 'AIM' },
  { pattern: /bim execution plan|\beir\b|employer.s information requirement/i, score: 5, label: 'BEP/EIR' },
  { pattern: /safety.critical/i, score: 4, label: 'Safety-critical' },
  { pattern: /client.side|employer.s\s+agent|owner.operator/i, score: 4, label: 'Client-side' },
];

const DESC_SENIORITY_WEIGHTS = [
  { pattern: /\bp&l\b/i, score: 6, label: 'P&L responsibility' },
  { pattern: /board level/i, score: 6, label: 'Board level' },
  { pattern: /thought leadership/i, score: 4, label: 'Thought leadership' },
  { pattern: /line management/i, score: 5, label: 'Line management' },
  { pattern: /budget responsibility/i, score: 5, label: 'Budget responsibility' },
  { pattern: /\b(10|12|15)\+?\s*years?\b/i, score: 5, label: '10+ years experience' },
  { pattern: /8\+?\s*years?\b/i, score: 4, label: '8+ years experience' },
  { pattern: /client.facing/i, score: 3, label: 'Client-facing' },
  { pattern: /\bstrategy\b/i, score: 3, label: 'Strategy' },
  { pattern: /\bbpss\b|sc\s+cleared|security clearance/i, score: 3, label: 'Security clearance' },
  { pattern: /programme.level|across the programme/i, score: 3, label: 'Programme-level' },
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

const GREEN_THRESHOLD = 12;
const AMBER_THRESHOLD = 5;

/**
 * Applies BM25-style diminishing returns to a category's raw point sum.
 * Prevents keyword-stuffed descriptions from dominating over precise matches.
 * basePoints is the "typical single signal" weight for this category.
 */
function bm25Cap(rawSum, basePoints) {
  if (rawSum <= 0) return 0;
  return basePoints * Math.log2(1 + rawSum / basePoints);
}

export function scoreJob(job) {
  const title = (job.title || '').toLowerCase();
  const desc = (job.description || '').toLowerCase();
  const fullText = title + ' ' + desc;

  const emptyMatches = { title: [], domain: [], experience: [] };
  for (const blocker of NON_AEC_BLOCKERS) {
    if (blocker.test(title)) {
      return { rating: 'Red', score: -99, reason: 'Non-AEC role', matches: emptyMatches };
    }
  }

  const titleMatches = [];
  const domainMatches = [];
  const experienceMatches = [];

  let titleRaw = 0;
  for (const { pattern, score: w, label } of TITLE_WEIGHTS) {
    if (pattern.test(title)) {
      titleRaw += w;
      titleMatches.push(label);
    }
  }

  let domainRaw = 0;
  for (const { pattern, score: w, label } of DOMAIN_WEIGHTS) {
    if (pattern.test(fullText)) {
      domainRaw += w;
      domainMatches.push(label);
    }
  }

  let expRaw = 0;
  for (const { pattern, score: w, label } of DESC_SENIORITY_WEIGHTS) {
    if (pattern.test(fullText)) {
      expRaw += w;
      experienceMatches.push(label);
    }
  }

  let negRaw = 0;
  for (const { pattern, score: w } of NEGATIVE_WEIGHTS) {
    if (pattern.test(fullText)) negRaw += w;
  }

  const score = Math.round(
    bm25Cap(titleRaw, 6) +
    bm25Cap(domainRaw, 5) +
    bm25Cap(expRaw, 5) +
    negRaw
  );

  const rating = score >= GREEN_THRESHOLD ? 'Green' : score >= AMBER_THRESHOLD ? 'Amber' : 'Red';

  const parts = [];
  if (titleMatches.length > 0) parts.push(`Title: ${titleMatches.join(', ')}`);
  if (domainMatches.length > 0) parts.push(`Domain: ${domainMatches.slice(0, 3).join(', ')}`);
  if (experienceMatches.length > 0) parts.push(`Experience: ${experienceMatches.slice(0, 2).join(', ')}`);
  const reason = parts.length > 0 ? parts.join(' · ') : null;

  const matches = {
    title: titleMatches,
    domain: domainMatches,
    experience: experienceMatches,
  };

  return { rating, score, reason, matches };
}
