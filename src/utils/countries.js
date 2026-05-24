function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const COUNTRY_CONFIGS = {
  uk: {
    aliases: ['uk', 'gb', 'united kingdom', 'great britain', 'britain', 'england'],
    adzunaCode: 'gb',
    defaultCurrency: 'GBP',
    linkedinLabel: 'United Kingdom',
    linkedinAcceptLanguage: 'en-GB,en;q=0.9',
    serperLocation: 'United Kingdom',
    serperGl: 'uk',
    serperHl: 'en',
    serperJobsTerm: 'jobs',
  },
  it: {
    aliases: ['it', 'italy', 'italia'],
    adzunaCode: 'it',
    defaultCurrency: 'EUR',
    linkedinLabel: 'Italia',
    linkedinAcceptLanguage: 'it-IT,it;q=0.9,en;q=0.7',
    serperLocation: 'Italy',
    serperGl: 'it',
    serperHl: 'it',
    serperJobsTerm: 'lavoro',
  },
  de: {
    aliases: ['de', 'germany', 'deutschland'],
    adzunaCode: 'de',
    defaultCurrency: 'EUR',
    linkedinLabel: 'Germany',
    linkedinAcceptLanguage: 'de-DE,de;q=0.9,en;q=0.7',
    serperLocation: 'Germany',
    serperGl: 'de',
    serperHl: 'de',
    serperJobsTerm: 'jobs',
  },
  nl: {
    aliases: ['nl', 'netherlands', 'the netherlands', 'holland'],
    adzunaCode: 'nl',
    defaultCurrency: 'EUR',
    linkedinLabel: 'Netherlands',
    linkedinAcceptLanguage: 'nl-NL,nl;q=0.9,en;q=0.7',
    serperLocation: 'Netherlands',
    serperGl: 'nl',
    serperHl: 'nl',
    serperJobsTerm: 'vacatures',
  },
  dk: {
    aliases: ['dk', 'denmark', 'danmark'],
    adzunaCode: null,
    defaultCurrency: 'DKK',
    linkedinLabel: 'Denmark',
    linkedinAcceptLanguage: 'da-DK,da;q=0.9,en;q=0.7',
    serperLocation: 'Denmark',
    serperGl: 'dk',
    serperHl: 'da',
    serperJobsTerm: 'job',
  },
};

const COUNTRY_LOOKUP = new Map();
for (const [code, config] of Object.entries(COUNTRY_CONFIGS)) {
  COUNTRY_LOOKUP.set(code, code);
  for (const alias of config.aliases) {
    COUNTRY_LOOKUP.set(alias.toLowerCase(), code);
  }
}

const COUNTRY_PATTERNS = Object.fromEntries(
  Object.entries(COUNTRY_CONFIGS).map(([code, config]) => [
    code,
    new RegExp(`\\b(?:${config.aliases.map(escapeRegex).join('|')})\\b`, 'i'),
  ])
);

const US_LOCATION_PATTERNS = [
  /\b(?:united states(?: of america)?|usa|u\.s\.a?)\b/i,
  /,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\b/i,
  /\b(?:alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|district of columbia|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming)\b/i,
];

const US_TEXT_PATTERNS = [
  /\b(?:united states(?: of america)?|usa|u\.s\.a?)\b/i,
  /\b(?:us-based|usa-based|u\.s\.-based|us only|usa only|u\.s\. only)\b/i,
];

const GENERIC_REMOTE_LOCATION_RE = /^\s*(?:remote|hybrid|on-?site|onsite|home\s*based|home-based|work\s*from\s*home)\b/i;

export const SUPPORTED_COUNTRIES = Object.keys(COUNTRY_CONFIGS);
export const DEFAULT_COUNTRY = 'uk';

export function maybeNormalizeCountry(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return null;
  return COUNTRY_LOOKUP.get(normalized) ?? null;
}

export function normalizeCountry(value) {
  return maybeNormalizeCountry(value) ?? DEFAULT_COUNTRY;
}

export function inferCountryFromLocation(value) {
  return maybeNormalizeCountry(value);
}

export function getCountryConfig(value) {
  return COUNTRY_CONFIGS[normalizeCountry(value)];
}

export function textMentionsCountry(text, country) {
  const pattern = COUNTRY_PATTERNS[normalizeCountry(country)];
  return pattern.test(String(text ?? ''));
}

export function isGenericRemoteLocation(value) {
  return GENERIC_REMOTE_LOCATION_RE.test(String(value ?? '').trim());
}

function detectMentionedCountries(text) {
  const haystack = String(text ?? '');
  const mentioned = new Set();

  for (const [code, pattern] of Object.entries(COUNTRY_PATTERNS)) {
    if (pattern.test(haystack)) {
      mentioned.add(code);
    }
  }

  return mentioned;
}

function locationLooksExplicitlyAmerican(text) {
  const haystack = String(text ?? '');
  return US_LOCATION_PATTERNS.some((pattern) => pattern.test(haystack));
}

function textLooksExplicitlyAmerican(text) {
  const haystack = String(text ?? '');
  return US_TEXT_PATTERNS.some((pattern) => pattern.test(haystack));
}

export function jobMatchesCountry(job, country) {
  const targetCountry = normalizeCountry(country);
  const locationText = String(job?.location ?? '').trim();
  const locationMentions = detectMentionedCountries(locationText);

  if (locationLooksExplicitlyAmerican(locationText)) {
    return false;
  }

  if (locationMentions.size > 0 && !locationMentions.has(targetCountry)) {
    return false;
  }

  if (!locationText || isGenericRemoteLocation(locationText)) {
    const secondaryText = [job?.title, job?.description].filter(Boolean).join(' | ');
    const secondaryMentions = detectMentionedCountries(secondaryText);

    if (textLooksExplicitlyAmerican(secondaryText)) {
      return false;
    }

    if (secondaryMentions.size > 0 && !secondaryMentions.has(targetCountry)) {
      return false;
    }
  }

  return true;
}