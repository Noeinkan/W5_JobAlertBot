const REQUIRED_KEYWORDS = [
  'bim',
  'building information',
  'digital construction',
  'digital delivery',
  'digital twin',
  'information manager',
  'information management',
  'iso 19650',
  'common data environment',
  'cde',
  'revit',
  'navisworks',
  'autodesk',
  'projectwise',
  'construction cloud',
  'acc ',
  'digital engineering',
  'digital lead',
  'scan to bim',
  'point cloud',
  'aec',
  'infrastructure digital',
];

const EXCLUDE_TITLE_KEYWORDS = [
  'care assistant',
  'carer',
  'nurse',
  'nursing',
  'teacher',
  'teaching',
  'librarian',
  'solicitor',
  'lawyer',
  'legal',
  'actuary',
  'hr manager',
  'human resources',
  'chef',
  'bartender',
  'sales manager',
  'field sales',
  'mortgage',
  'financial adviser',
  'insurance',
  'nanny',
  'cleaner',
  'receptionist',
  'pa to',
  'personal assistant',
  'customer success',
  'marketing director',
  'marketing manager',
  'seo',
  'social media',
  'copywriter',
  'recruitment consultant',
  'estate agent',
  'lettings',
  'home manager',
  'care home',
  'delivery driver',
  'warehouse',
  'forklift',
  'security officer',
  'pharmacist',
  'dentist',
  'doctor',
  'gp ',
  'veterinary',
];

export function isRelevantJob(title, description) {
  const titleLower = String(title ?? '').toLowerCase();
  const descLower = String(description ?? '').toLowerCase();

  const hasRequired = REQUIRED_KEYWORDS.some(
    (kw) => titleLower.includes(kw) || descLower.includes(kw)
  );

  if (!hasRequired) {
    return false;
  }

  const hasExcluded = EXCLUDE_TITLE_KEYWORDS.some((kw) => titleLower.includes(kw));

  return !hasExcluded;
}
