import { getCountryConfig } from './countries.js';

const contractPattern = /\b(contract|freelance|outside\s+ir35|inside\s+ir35|day\s*rate|daily\s*rate|per\s*day|\/day|\bpd\b|\bp\/d\b|partita\s*iva|p\.\s*iva|piva|consulenza|al\s*giorno|\/giorno)\b/i;
const outsideIr35Pattern = /outside\s+ir35/i;
const insideIr35Pattern = /inside\s+ir35/i;

function detectCurrency(text = '') {
  const t = String(text);
  if (/€|\beur\b|\bral\b|lordi\s*annui|lordo\s*annuo/i.test(t)) return 'EUR';
  if (/£|\bgbp\b/i.test(t)) return 'GBP';
  return null;
}

function cleanNumber(value, currencyHint = null) {
  if (value == null || value === '') return null;
  let s = String(value).trim();
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');

  if (hasComma && hasDot) {
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma > lastDot) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (hasComma) {
    if (currencyHint === 'EUR') {
      s = s.replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (hasDot && currencyHint === 'EUR') {
    const parts = s.split('.');
    const allThousands = parts.slice(1).every((p) => p.length === 3);
    if (parts.length > 1 && allThousands) {
      s = parts.join('');
    }
  }

  const num = Number.parseFloat(s);
  return Number.isFinite(num) ? num : null;
}

export function parseAmount(digits, suffix, currencyHint = null) {
  const base = cleanNumber(digits, currencyHint);
  if (base == null) return null;
  return /k/i.test(String(suffix ?? '')) ? base * 1000 : base;
}

const UNIT_DAY_RE = /(per\s*day|\/day|daily|day\s*rate|\bp\/d\b|\bpd\b|al\s*giorno|\/giorno|giornaliero)/i;
const UNIT_YEAR_RE = /(per\s*(annum|year)|\/year|pa\b|p\.a\.|all['’]\s*anno|annuo|annui|lordi\s*annui|lordo\s*annuo|\bral\b)/i;
const UNIT_MONTH_RE = /(per\s*month|\/month|monthly|al\s*mese|mensile|mensili)/i;

function detectUnit(text = '') {
  const normalized = String(text);
  if (UNIT_DAY_RE.test(normalized)) return 'day';
  if (UNIT_YEAR_RE.test(normalized)) return 'year';
  if (UNIT_MONTH_RE.test(normalized)) return 'month';
  return null;
}

const SUFFIX_RE = `(${UNIT_DAY_RE.source}|${UNIT_YEAR_RE.source}|${UNIT_MONTH_RE.source})`;
const SYM_RE = '[£€]';
const NUM_RE = '([\\d.,]+)';
// A monetary token: symbol can appear before (£50,000) or after (50.000€). At least one must be present.
const MONEY_BEFORE = `${SYM_RE}\\s?${NUM_RE}\\s*(k)?\\s*${SYM_RE}?`;
const MONEY_AFTER = `${NUM_RE}\\s*(k)?\\s*${SYM_RE}`;

function findRange(text = '', currencyHint = null) {
  const patterns = [
    // £X - £Y / £X to £Y / £X a £Y (symbol-before on both)
    new RegExp(`${SYM_RE}\\s?${NUM_RE}\\s*(k)?\\s*(?:-|to|a|e)\\s*${SYM_RE}?\\s?${NUM_RE}\\s*(k)?\\s*${SUFFIX_RE}?`, 'i'),
    // X€ - Y€ / X€ a Y€ (symbol-after on both — Italian style)
    new RegExp(`${NUM_RE}\\s*(k)?\\s*${SYM_RE}\\s*(?:-|to|a|e)\\s*${NUM_RE}\\s*(k)?\\s*${SYM_RE}\\s*${SUFFIX_RE}?`, 'i'),
    // Fallback: bare numbers separated by separator (no symbols)
    new RegExp(`${NUM_RE}\\s*(k)?\\s*(?:-|to|a)\\s*${NUM_RE}\\s*(k)?\\s*${SUFFIX_RE}?`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = String(text).match(pattern);
    if (match) {
      const minSuffix = match[2];
      const maxSuffix = match[4] ?? minSuffix;
      return {
        min: parseAmount(match[1], minSuffix, currencyHint),
        max: parseAmount(match[3], maxSuffix, currencyHint),
        unit: detectUnit(match[5] ?? text),
      };
    }
  }

  return null;
}

function findSingle(text = '', currencyHint = null) {
  // symbol-before
  const reBefore = new RegExp(`${SYM_RE}\\s?${NUM_RE}\\s*(k)?\\s*${SUFFIX_RE}?`, 'i');
  // symbol-after (Italian: 50.000€)
  const reAfter = new RegExp(`${NUM_RE}\\s*(k)?\\s*${SYM_RE}\\s*${SUFFIX_RE}?`, 'i');
  const match = String(text).match(reBefore) ?? String(text).match(reAfter);
  if (!match) return null;
  return {
    min: parseAmount(match[1], match[2], currencyHint),
    max: null,
    unit: detectUnit(match[3] ?? text),
  };
}

function findBetween(text = '', currencyHint = null) {
  const en = new RegExp(`between\\s+${SYM_RE}\\s?${NUM_RE}\\s*(k)?\\s+and\\s+${SYM_RE}?\\s?${NUM_RE}\\s*(k)?`, 'i');
  // Italian: "tra/da X(€)? e/a Y(€)?" — symbol may appear before or after each number
  const itBefore = new RegExp(`(?:tra|da)\\s+${SYM_RE}?\\s?${NUM_RE}\\s*(k)?\\s+(?:e|a)\\s+${SYM_RE}?\\s?${NUM_RE}\\s*(k)?`, 'i');
  const itAfter = new RegExp(`(?:tra|da)\\s+${NUM_RE}\\s*(k)?\\s*${SYM_RE}?\\s+(?:e|a)\\s+${NUM_RE}\\s*(k)?\\s*${SYM_RE}?`, 'i');
  const match = String(text).match(en) ?? String(text).match(itBefore) ?? String(text).match(itAfter);
  if (!match) return null;
  const minSuffix = match[2];
  const maxSuffix = match[4] ?? minSuffix;
  return {
    min: parseAmount(match[1], minSuffix, currencyHint),
    max: parseAmount(match[3], maxSuffix, currencyHint),
    unit: detectUnit(text),
  };
}

function findUpTo(text = '', currencyHint = null) {
  const re = new RegExp(`\\b(?:up\\s*to|fino\\s*a)\\s*${SYM_RE}?\\s?${NUM_RE}\\s*(k)?`, 'i');
  const match = String(text).match(re);
  if (!match) return null;
  return {
    min: null,
    max: parseAmount(match[1], match[2], currencyHint),
    unit: detectUnit(text),
  };
}

function findFrom(text = '', currencyHint = null) {
  const re = new RegExp(`\\b(?:from|starting\\s*(?:at|from)|a\\s*partire\\s*da|da)\\s*${SYM_RE}?\\s?${NUM_RE}\\s*(k)?`, 'i');
  const match = String(text).match(re);
  if (!match) return null;
  return {
    min: parseAmount(match[1], match[2], currencyHint),
    max: null,
    unit: detectUnit(text),
  };
}

function findCirca(text = '', currencyHint = null) {
  const re = new RegExp(`(?:\\bcirca\\b|\\bc\\.\\s*|\\baround\\b|\\bapprox(?:imately)?\\b|\\bintorno\\s*a\\b)\\s*${SYM_RE}?\\s?${NUM_RE}\\s*(k)?`, 'i');
  const match = String(text).match(re);
  if (!match) return null;
  return {
    min: parseAmount(match[1], match[2], currencyHint),
    max: null,
    unit: detectUnit(text),
  };
}

function findRal(text = '', currencyHint = null) {
  const re = new RegExp(`\\bral\\b\\s*(?:di|pari\\s*a)?\\s*${SYM_RE}?\\s?${NUM_RE}\\s*(k)?`, 'i');
  const match = String(text).match(re);
  if (!match) return null;
  return {
    min: parseAmount(match[1], match[2], currencyHint),
    max: null,
    unit: 'year',
  };
}

function hasOte(text = '') {
  return /\bote\b/i.test(String(text));
}

function formatMoney(value, currency = 'GBP') {
  if (!Number.isFinite(value)) return null;
  const locale = currency === 'EUR'
    ? 'it-IT'
    : currency === 'DKK'
      ? 'da-DK'
      : 'en-GB';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value);
}

export function detectContractType(text = '') {
  return contractPattern.test(String(text));
}

export function buildSalaryInfo({
  title = '',
  description = '',
  extensions = [],
  salaryMin = null,
  salaryMax = null,
  country = null,
} = {}) {
  const combinedText = [title, description, ...(extensions ?? [])].filter(Boolean).join(' | ');
  const detectedCurrency = detectCurrency(combinedText);
  const currency = detectedCurrency ?? getCountryConfig(country).defaultCurrency;

  const explicitRange =
    findRange(combinedText, currency)
    ?? findBetween(combinedText, currency)
    ?? findRal(combinedText, currency)
    ?? findUpTo(combinedText, currency)
    ?? findFrom(combinedText, currency)
    ?? findCirca(combinedText, currency)
    ?? findSingle(combinedText, currency);

  const fallbackMin = cleanNumber(salaryMin, currency);
  const fallbackMax = cleanNumber(salaryMax, currency);
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
    currency,
    salaryText: formatSalary({
      isContract: inferredContract,
      salaryMin: normalizedMin,
      salaryMax: normalizedMax,
      rateSuffix,
      ir35,
      ote,
      currency,
    }),
  };
}

export function formatSalary({ isContract, salaryMin, salaryMax, rateSuffix = '', ir35 = '', ote = false, currency = 'GBP' }) {
  const min = cleanNumber(salaryMin, currency);
  const max = cleanNumber(salaryMax, currency);
  const oteSuffix = ote ? ' (OTE)' : '';

  if (min == null && max == null) {
    return 'Salary not listed';
  }

  if (min != null && max != null) {
    if (isContract) {
      return `${formatMoney(min, currency)}-${formatMoney(max, currency)}${rateSuffix}${ir35}${oteSuffix}`;
    }
    return `${formatMoney(min, currency)} - ${formatMoney(max, currency)}${oteSuffix}`;
  }

  if (min == null) {
    if (isContract) {
      return `Up to ${formatMoney(max, currency)}${rateSuffix}${ir35}${oteSuffix}`;
    }
    return `Up to ${formatMoney(max, currency)}${oteSuffix}`;
  }

  if (isContract) {
    return `${formatMoney(min, currency)}${rateSuffix}${ir35}`;
  }

  return `From ${formatMoney(min, currency)}`;
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
