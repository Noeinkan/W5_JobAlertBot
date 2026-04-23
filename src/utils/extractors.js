import { buildSalaryInfo, parseAmount } from './salary.js';

const remoteOnsitePatterns = [
  { type: 'remote', re: /\b(fully\s*remote|100%\s*remote|remote[- ]first|wfh\s*only|work\s*from\s*home(?:\s*only)?)\b/i },
  { type: 'hybrid', re: /\b(hybrid|flexible\s*working|\d+\s*days?\s*(?:in\s*(?:the\s*)?office|on[- ]site|remote))\b/i },
  { type: 'onsite', re: /\b(on[- ]site\s*only|office[- ]based|fully\s*on[- ]site|five\s*days?\s*in\s*(?:the\s*)?office)\b/i },
  { type: 'remote', re: /\bremote\b/i },
];

function detectRemoteType(text) {
  const normalized = String(text);
  for (const { type, re } of remoteOnsitePatterns) {
    if (re.test(normalized)) return type;
  }
  return null;
}

function detectContractLengthMonths(text) {
  const normalized = String(text);
  const match =
    normalized.match(/\b(\d{1,2})\s*(?:-|to)\s*(\d{1,2})\s*month/i)
    ?? normalized.match(/\b(\d{1,2})\s*month(?:s)?\s*(?:contract|fixed[- ]?term|ftc|rolling)/i)
    ?? normalized.match(/\b(?:fixed[- ]?term|ftc|contract)\s*(?:of|for)?\s*(\d{1,2})\s*month/i);
  if (!match) return null;
  const value = Number.parseInt(match[2] ?? match[1], 10);
  return Number.isFinite(value) ? value : null;
}

const SECTOR_PATTERNS = {
  nuclear: /\b(nuclear|fission|sizewell|hinkley|sellafield|amrc)\b/i,
  rail: /\b(rail(?:way)?|hs2|network\s*rail|crossrail|(?:london\s*)?underground|metro|tfl\b)\b/i,
  highways: /\b(highways?|motorway|national\s*highways|dft\b)\b/i,
  defence: /\b(defen[sc]e|\bmod\b|royal\s*(?:navy|air\s*force)|british\s*army|dstl|aerospace\s*defence)\b/i,
  healthcare: /\b(healthcare|hospital|\bnhs\b|medical\s*facility|mental\s*health\s*trust)\b/i,
  education: /\b(department\s*for\s*education|\bdfe\b|school\s*(?:building|estate)|university\s*estate|higher\s*education)\b/i,
  water: /\b(thames\s*water|severn\s*trent|anglian\s*water|\bamp[678]\b|wastewater|water\s*utility|water\s*treatment)\b/i,
  aviation: /\b(aviation|airport|heathrow|gatwick|stansted|luton\s*airport|manchester\s*airport)\b/i,
  energy: /\b(power\s*station|wind\s*farm|offshore\s*wind|solar\s*farm|renewables?|national\s*grid)\b/i,
  oilgas: /\b(oil\s*(?:&|and)?\s*gas|\blng\b|petrochemical|refinery|upstream|downstream)\b/i,
  commercial: /\b(commercial\s*(?:property|office\s*development|real\s*estate))\b/i,
  residential: /\b(residential|housing|build[- ]to[- ]rent|\bbtr\b|social\s*housing|\bprs\b)\b/i,
};

function detectSectors(text) {
  const found = [];
  for (const [sector, re] of Object.entries(SECTOR_PATTERNS)) {
    if (re.test(text)) found.push(sector);
  }
  return found;
}

const CLEARANCE_PATTERNS = {
  SC: /\bSC[- ]?clear(?:ance|ed|ing)?\b|security\s*clear(?:ance|ed)\s*(?:to\s*)?SC\b/i,
  DV: /\bDV[- ]?clear(?:ance|ed|ing)?\b|developed\s*vetting\b/i,
  BPSS: /\bBPSS\b|baseline\s*personnel\s*security/i,
  NPPV: /\bNPPV[123]?\b|non[- ]police\s*personnel\s*vetting/i,
  DBS: /\benhanced\s*DBS\b/i,
  CTC: /\bCTC[- ]?clear(?:ance|ed)?\b|counter[- ]terror(?:ism)?\s*check/i,
};

function detectClearances(text) {
  const found = [];
  for (const [level, re] of Object.entries(CLEARANCE_PATTERNS)) {
    if (re.test(text)) found.push(level);
  }
  return found;
}

const TECH_TOOL_PATTERNS = [
  { name: 'Revit', re: /\bRevit\b/i },
  { name: 'Navisworks', re: /\bNavisworks\b/i },
  { name: 'ProjectWise', re: /\bProject[- ]?Wise\b/i },
  { name: 'ACC', re: /\b(?:Autodesk\s*Construction\s*Cloud|\bACC\b|BIM\s*360)\b/i },
  { name: 'Synchro', re: /\bSynchro\b/i },
  { name: 'Dynamo', re: /\bDynamo\b/i },
  { name: '12d', re: /\b12d\b/i },
  { name: 'Civil 3D', re: /\bCivil\s*3D\b/i },
  { name: 'Bentley', re: /\b(?:MicroStation|OpenBuildings|OpenRoads|OpenRail)\b/i },
  { name: 'Forge/APS', re: /\b(?:Autodesk\s*Forge|Autodesk\s*Platform\s*Services|\bAPS\b)\b/i },
  { name: 'AutoCAD', re: /\bAutoCAD\b/i },
  { name: 'Tekla', re: /\bTekla\b/i },
  { name: 'Solibri', re: /\bSolibri\b/i },
  { name: 'Rhino', re: /\bRhino(?:\s*3D)?\b/i },
  { name: 'Grasshopper', re: /\bGrasshopper\b/i },
  { name: 'IFC', re: /\bIFC\b/i },
];

function detectTechTools(text) {
  const found = [];
  for (const { name, re } of TECH_TOOL_PATTERNS) {
    if (re.test(text)) found.push(name);
  }
  return found;
}

function detectYearsExperience(text) {
  const patterns = [
    /\b(\d{1,2})\s*\+\s*years?\s*(?:of\s*)?(?:experience|exp)\b/i,
    /\bat\s*least\s*(\d{1,2})\s*years?\s*(?:of\s*)?(?:experience|exp)?/i,
    /\bminimum\s*(?:of\s*)?(\d{1,2})\s*years?\s*(?:of\s*)?(?:experience|exp)?/i,
    /\b(\d{1,2})\s*years?\s*\+\s*(?:of\s*)?(?:experience|exp)?/i,
    /\b(\d{1,2})\s*years?\s*minimum\s*(?:of\s*)?(?:experience|exp)?/i,
  ];
  for (const re of patterns) {
    const match = String(text).match(re);
    if (match) {
      const value = Number.parseInt(match[1], 10);
      if (Number.isFinite(value) && value > 0 && value < 40) return value;
    }
  }
  return null;
}

function detectBenefits(text) {
  const normalized = String(text);
  const result = {
    hasBonus: /\bbonus\b/i.test(normalized),
    bonusPercent: null,
    carAllowance: null,
    pensionPercent: null,
    hasEquity: /\b(equity|share\s*options?|stock\s*options?|vesting)\b/i.test(normalized),
  };

  const bonusPercent = normalized.match(/(\d{1,3})\s*%\s*bonus\b/i)
    ?? normalized.match(/\bbonus\s*(?:of\s*)?(?:up\s*to\s*)?(\d{1,3})\s*%/i);
  if (bonusPercent) {
    const value = Number.parseInt(bonusPercent[1], 10);
    if (Number.isFinite(value) && value >= 0 && value <= 100) result.bonusPercent = value;
  }

  const carPatterns = [
    /car\s*allowance\s*(?:of\s*)?£?\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?/i,
    /£\s?(\d[\d,]*(?:\.\d+)?)\s*(k)?\s*(?:per\s*(?:year|annum)\s*)?car\s*allowance/i,
  ];
  for (const re of carPatterns) {
    const m = normalized.match(re);
    if (m) {
      const amount = parseAmount(m[1], m[2]);
      if (Number.isFinite(amount)) {
        result.carAllowance = amount;
        break;
      }
    }
  }

  const pensionMatch = normalized.match(/pension\s*(?:contribution\s*)?(?:of\s*)?(?:up\s*to\s*)?(\d{1,2})\s*%/i)
    ?? normalized.match(/(\d{1,2})\s*%\s*pension\b/i);
  if (pensionMatch) {
    const value = Number.parseInt(pensionMatch[1], 10);
    if (Number.isFinite(value) && value >= 0 && value <= 50) result.pensionPercent = value;
  }

  return result;
}

export function extractJobSignals({ title = '', description = '', salaryTextHint = '' } = {}) {
  const combined = [title, description, salaryTextHint].filter(Boolean).join(' | ');
  const salary = buildSalaryInfo({ title, description, extensions: [salaryTextHint].filter(Boolean) });
  const benefits = detectBenefits(combined);

  return {
    salaryMin: salary.salaryMin,
    salaryMax: salary.salaryMax,
    salaryText: salary.salaryText,
    isContract: salary.isContract,
    remoteType: detectRemoteType(combined),
    contractLengthMonths: detectContractLengthMonths(combined),
    sectors: detectSectors(combined),
    clearances: detectClearances(combined),
    techTools: detectTechTools(combined),
    yearsExperience: detectYearsExperience(combined),
    hasBonus: benefits.hasBonus,
    bonusPercent: benefits.bonusPercent,
    carAllowance: benefits.carAllowance,
    pensionPercent: benefits.pensionPercent,
    hasEquity: benefits.hasEquity,
  };
}

function hasValue(value) {
  return value != null && value !== '' && !(typeof value === 'string' && value === 'Salary not listed');
}

function isRangeTighter(currentMin, currentMax, candidateMin, candidateMax) {
  const currentHasRange = Number.isFinite(currentMin) && Number.isFinite(currentMax);
  const candidateHasRange = Number.isFinite(candidateMin) && Number.isFinite(candidateMax);
  if (candidateHasRange && !currentHasRange) return true;
  return false;
}

export function mergeJobSignals(job, signals) {
  const merged = { ...job };

  const currentMin = Number.isFinite(job.salaryMin) ? job.salaryMin : null;
  const currentMax = Number.isFinite(job.salaryMax) ? job.salaryMax : null;
  const candidateMin = Number.isFinite(signals.salaryMin) ? signals.salaryMin : null;
  const candidateMax = Number.isFinite(signals.salaryMax) ? signals.salaryMax : null;

  const upgradeMin = currentMin == null && candidateMin != null;
  const upgradeMax = currentMax == null && candidateMax != null;
  const upgradeRange = isRangeTighter(currentMin, currentMax, candidateMin, candidateMax);

  if (upgradeMin || upgradeMax || upgradeRange) {
    merged.salaryMin = candidateMin ?? currentMin;
    merged.salaryMax = candidateMax ?? currentMax;
    merged.salaryText = signals.salaryText;
    merged.isContract = signals.isContract || job.isContract;
  }

  if (!job.isContract && signals.isContract) {
    merged.isContract = true;
  }

  if (!hasValue(job.remoteType) && hasValue(signals.remoteType)) {
    merged.remoteType = signals.remoteType;
  }

  if (!Number.isFinite(job.contractLengthMonths) && Number.isFinite(signals.contractLengthMonths)) {
    merged.contractLengthMonths = signals.contractLengthMonths;
  }

  merged.sectors = unionArrays(job.sectors, signals.sectors);
  merged.clearances = unionArrays(job.clearances, signals.clearances);
  merged.techTools = unionArrays(job.techTools, signals.techTools);

  if (!Number.isFinite(job.yearsExperience) && Number.isFinite(signals.yearsExperience)) {
    merged.yearsExperience = signals.yearsExperience;
  }

  if (!job.hasBonus && signals.hasBonus) merged.hasBonus = true;
  if (!job.hasEquity && signals.hasEquity) merged.hasEquity = true;

  if (!Number.isFinite(job.bonusPercent) && Number.isFinite(signals.bonusPercent)) {
    merged.bonusPercent = signals.bonusPercent;
  }
  if (!Number.isFinite(job.carAllowance) && Number.isFinite(signals.carAllowance)) {
    merged.carAllowance = signals.carAllowance;
  }
  if (!Number.isFinite(job.pensionPercent) && Number.isFinite(signals.pensionPercent)) {
    merged.pensionPercent = signals.pensionPercent;
  }

  return merged;
}

function unionArrays(a, b) {
  const out = new Set();
  for (const v of Array.isArray(a) ? a : []) if (v != null) out.add(v);
  for (const v of Array.isArray(b) ? b : []) if (v != null) out.add(v);
  return Array.from(out);
}
