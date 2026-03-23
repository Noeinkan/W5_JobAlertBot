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
    /£\s?([\d,]+)\s*(?:-|to)\s*£\s?([\d,]+)\s*(per\s*day|\/day|daily|day\s*rate|per\s*annum|per\s*year|\/year|pa\b|p\.a\.)?/i,
    /([\d,]+)\s*(?:-|to)\s*([\d,]+)\s*(per\s*day|\/day|daily|day\s*rate|per\s*annum|per\s*year|\/year|pa\b|p\.a\.)?/i,
  ];

  for (const pattern of patterns) {
    const match = String(text).match(pattern);

    if (match) {
      return {
        min: cleanNumber(match[1]),
        max: cleanNumber(match[2]),
        unit: detectUnit(match[3] ?? text),
      };
    }
  }

  return null;
}

function findSingle(text = '') {
  const match = String(text).match(/£\s?([\d,]+)\s*(per\s*day|\/day|daily|day\s*rate|per\s*annum|per\s*year|\/year|pa\b|p\.a\.)?/i);

  if (!match) {
    return null;
  }

  return {
    min: cleanNumber(match[1]),
    max: null,
    unit: detectUnit(match[2] ?? text),
  };
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
  const explicitRange = findRange(combinedText) ?? findSingle(combinedText);
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
    }),
  };
}

export function formatSalary({ isContract, salaryMin, salaryMax, rateSuffix = '', ir35 = '' }) {
  const min = cleanNumber(salaryMin);
  const max = cleanNumber(salaryMax);

  if (min == null && max == null) {
    return 'Salary not listed';
  }

  if (min != null && max != null) {
    if (isContract) {
      return `${formatMoney(min)}-${formatMoney(max)}${rateSuffix}${ir35}`;
    }

    return `${formatMoney(min)} - ${formatMoney(max)}`;
  }

  if (isContract) {
    return `${formatMoney(min ?? max)}${rateSuffix}${ir35}`;
  }

  return `From ${formatMoney(min ?? max)}`;
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
