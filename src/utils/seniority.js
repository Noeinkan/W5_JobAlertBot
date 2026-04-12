const JUNIOR_TITLE_KEYWORDS = [
  'junior',
  'graduate',
  'intern',
  'apprentice',
  'trainee',
  'entry level',
  'entry-level',
  'assistant ',
  'coordinator',
  'technician',
  'modeller',
  'modeler',
  'cad technician',
  'revit technician',
  'bim technician',
  'bim coordinator',
  'document controller',
];

const SENIOR_TITLE_KEYWORDS = [
  'head of',
  'director',
  'associate director',
  'principal',
  'lead',
  'senior manager',
  'senior bim',
  'senior digital',
  'senior information',
  'senior consultant',
  'chief',
  'vp ',
  'vice president',
  'programme manager',
  'program manager',
  'solution architect',
  'technical director',
];

const SENIOR_DESCRIPTION_INDICATORS = [
  '10+ years',
  '10 years',
  '8+ years',
  'associate director',
  'director level',
  'senior leadership',
  'head of department',
  'line management',
  'p&l responsibility',
  'budget responsibility',
  'client-facing',
  'thought leadership',
  'strategy and vision',
  'board level',
  'c-suite',
  '£90,000',
  '£90k',
  '£95,000',
  '£100,000',
  '£100k',
  '£110,000',
  '£120,000',
];

/**
 * Checks whether a job meets the seniority threshold.
 * Returns { passes: boolean, reason: string | null }
 */
export function isSeniorEnough(job) {
  const title = String(job.title ?? '').toLowerCase();
  const description = String(job.description ?? '').toLowerCase();

  // Step 1: Block junior titles immediately
  if (JUNIOR_TITLE_KEYWORDS.some((kw) => title.includes(kw))) {
    return { passes: false, reason: null };
  }

  // Step 2: Pass if salary meets threshold
  if (job.isContract && Number.isFinite(job.salaryMin) && job.salaryMin >= 450) {
    return { passes: true, reason: 'day rate \u2265 \u00a3450' };
  }

  if (!job.isContract && Number.isFinite(job.salaryMin) && job.salaryMin >= 90000) {
    return { passes: true, reason: 'salary \u2265 \u00a390k' };
  }

  // Step 3: Pass if title indicates seniority
  const titleMatch = SENIOR_TITLE_KEYWORDS.find((kw) => title.includes(kw));

  if (titleMatch) {
    return { passes: true, reason: `title seniority (${titleMatch.trim()})` };
  }

  // Step 4: Pass if description indicates seniority
  const descMatch = SENIOR_DESCRIPTION_INDICATORS.find((kw) => description.includes(kw));

  if (descMatch) {
    return { passes: true, reason: `description seniority (${descMatch})` };
  }

  // Step 5: Pass if title contains "manager" (BIM Manager, Information Manager etc. are senior in AEC)
  if (title.includes('manager')) {
    return { passes: true, reason: 'manager-level title' };
  }

  // Step 6: Default — block
  return { passes: false, reason: null };
}
