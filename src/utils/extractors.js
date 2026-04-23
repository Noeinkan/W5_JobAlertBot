import { buildSalaryInfo } from './salary.js';

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

export function extractJobSignals({ title = '', description = '', salaryTextHint = '' } = {}) {
  const combined = [title, description, salaryTextHint].filter(Boolean).join(' | ');
  const salary = buildSalaryInfo({ title, description, extensions: [salaryTextHint].filter(Boolean) });

  return {
    salaryMin: salary.salaryMin,
    salaryMax: salary.salaryMax,
    salaryText: salary.salaryText,
    isContract: salary.isContract,
    remoteType: detectRemoteType(combined),
    contractLengthMonths: detectContractLengthMonths(combined),
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

  return merged;
}
