const contractPattern = /\b(contract|freelance|outside\s+ir35|inside\s+ir35|day\s*rate|daily\s*rate|per\s*day|\/day|\bpd\b|\bp\/d\b)\b/i;
const outsideIr35Pattern = /outside\s+ir35/i;
const insideIr35Pattern = /inside\s+ir35/i;

function cleanNumber(value) {
  if (!value) {
    return null;
  }

  const normalized = Number.parseFloat(String(value).replace(/,/g, ''));
  return Number.isFinite(normalized) ? normalized : null;
}

export function parseAmount(digits, suffix) {
  const base = cleanNumber(digits);
  if (base == null) return null;
  return /k/i.test(String(suffix ?? '')) ? base * 1000 : base;
}

function detectUnit(text = '') {
  const normalized = String(text).toLowerCase();

  if (/(per\s*day|\/day|daily|day\s*rate|\bp\/d\b|\bpd\b)/i.test(normalized)) {
    return 'day';
  }

  if (/(per\s*(annum|year)|\/year|pa\b|p\.a\.)/i.test(normalized)) {
    return 'year';
  }

  return null;
}

function findRange(text = '') {
  const patterns = [
    /£\s?([\d,]+(?:\.\d+)?)\s*(k)?\s*(?:-|to)\s*£\s?([\d,]+(?:\.\d+)?)\s*(k)?\s*(per\s*day|\/day|daily|day\s*rate|per\s*annum|per\s*year|\/year|pa\b|p\.a\.)?/i,
    /([\d,]+(?:\.\d+)?)\s*(k)?\s*(?:-|to)\s*([\d,]+(?:\.\d+)?)\s*(k)?\s*(per\s*day|\/day|daily|day\s*rate|per\s*annum|per\s*year|\/year|pa\b|p\.a\.)?/i,
  ];

  for (const pattern of patterns) {
    const match = String(text).match(pattern);

    if (match) {
      const minSuffix = match[2];
      const maxSuffix = match[4] ?? minSuffix;
      return {
        min: parseAmount(match[1], minSuffix),
        max: parseAmount(match[3], maxSuffix),
        unit: detectUnit(match[5] ?? text),
      };
    }
  }

  return null;
}

function findSingle(text = '') {
  const match = String(text).match(/£\s?([\d,]+(?:\.\d+)?)\s*(k)?\s*(per\s*day|\/day|daily|day\s*rate|per\s*annum|per\s*year|\/year|pa\b|p\.a\.)?/i);

  if (!match) {
    return null;
  }

  return {
    min: parseAmount(match[1], match[2]),
    max: null,
    unit: detectUnit(match[3] ?? text),
  };
}

function findBetween(text = '') {
  const match = String(text).match(
    /between\s+£\s?([\d,]+(?:\.\d+)?)\s*(k)?\s+and\s+£?\s?([\d,]+(?:\.\d+)?)\s*(k)?/i,
  );
  if (!match) return null;
  const minSuffix = match[2];
  const maxSuffix = match[4] ?? minSuffix;
  return {
    min: parseAmount(match[1], minSuffix),
    max: parseAmount(match[3], maxSuffix),
    unit: detectUnit(text),
  };
}

function findUpTo(text = '') {
  const match = String(text).match(/\bup\s*to\s*£\s?([\d,]+(?:\.\d+)?)\s*(k)?/i);
  if (!match) return null;
  return {
    min: null,
    max: parseAmount(match[1], match[2]),
    unit: detectUnit(text),
  };
}

function findFrom(text = '') {
  const match = String(text).match(
    /\b(?:from|starting\s*(?:at|from))\s*£\s?([\d,]+(?:\.\d+)?)\s*(k)?/i,
  );
  if (!match) return null;
  return {
    min: parseAmount(match[1], match[2]),
    max: null,
    unit: detectUnit(text),
  };
}

function findCirca(text = '') {
  const match = String(text).match(
    /(?:\bcirca\b|\bc\.\s*|\baround\b|\bapprox(?:imately)?\b)\s*£\s?([\d,]+(?:\.\d+)?)\s*(k)?/i,
  );
  if (!match) return null;
  return {
    min: parseAmount(match[1], match[2]),
    max: null,
    unit: detectUnit(text),
  };
}

function hasOte(text = '') {
  return /\bote\b/i.test(String(text));
}

function formatMoney(value) {
  if (!Number.isFinite(value)) {
    return null;
  }

  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value);
}

export function detectContractType(text = '') {
  return contractPattern.test(String(text));
}

export function buildSalaryInfo({ title = '', description = '', extensions = [], salaryMin = null, salaryMax = null }) {
  const combinedText = [title, description, ...(extensions ?? [])].filter(Boolean).join(' | ');
  const explicitRange =
    findRange(combinedText)
    ?? findBetween(combinedText)
    ?? findUpTo(combinedText)
    ?? findFrom(combinedText)
    ?? findCirca(combinedText)
    ?? findSingle(combinedText);
  const fallbackMin = cleanNumber(salaryMin);
  const fallbackMax = cleanNumber(salaryMax);
  const textUnit = explicitRange?.unit ?? detectUnit(combinedText);
  const isDaily = textUnit === 'day';
  const inferredContract = detectContractType(combinedText) || isDaily;

  const normalizedMin = explicitRange?.min ?? fallbackMin;
  const normalizedMax = explicitRange?.max ?? fallbackMax;
  const rateSuffix = isDaily ? '/day' : '';
  const ir35 = outsideIr35Pattern.test(combinedText)
    ? ' Outside IR35'
    : insideIr35Pattern.test(combinedText)
      ? ' Inside IR35'
      : '';
  const ote = hasOte(combinedText);

  return {
    isContract: inferredContract,
    salaryMin: normalizedMin,
    salaryMax: normalizedMax,
    salaryText: formatSalary({
      isContract: inferredContract,
      salaryMin: normalizedMin,
      salaryMax: normalizedMax,
      rateSuffix,
      ir35,
      ote,
    }),
  };
}

export function formatSalary({ isContract, salaryMin, salaryMax, rateSuffix = '', ir35 = '', ote = false }) {
  const min = cleanNumber(salaryMin);
  const max = cleanNumber(salaryMax);
  const oteSuffix = ote ? ' (OTE)' : '';

  if (min == null && max == null) {
    return 'Salary not listed';
  }

  if (min != null && max != null) {
    if (isContract) {
      return `${formatMoney(min)}-${formatMoney(max)}${rateSuffix}${ir35}${oteSuffix}`;
    }

    return `${formatMoney(min)} - ${formatMoney(max)}${oteSuffix}`;
  }

  if (min == null) {
    if (isContract) {
      return `Up to ${formatMoney(max)}${rateSuffix}${ir35}${oteSuffix}`;
    }
    return `Up to ${formatMoney(max)}${oteSuffix}`;
  }

  if (isContract) {
    return `${formatMoney(min)}${rateSuffix}${ir35}`;
  }

  return `From ${formatMoney(min)}`;
}

export function passesMinimumSalary(job, minimumSalary) {
  if (minimumSalary == null) {
    return true;
  }

  if (!Number.isFinite(job.salaryMin) && !Number.isFinite(job.salaryMax)) {
    return true;
  }

  const max = Number.isFinite(job.salaryMax) ? job.salaryMax : job.salaryMin;
  return max >= minimumSalary;
}
