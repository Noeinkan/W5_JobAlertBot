import { jobMatchesCountry } from './countries.js';

/**
 * Country coverage per source. Sources not listed default to UK-only.
 * Multi-country adapters are parameterized by country code or geo location.
 */
const SOURCE_COUNTRIES = {
  adzuna: ['uk', 'it', 'de', 'nl'],
  linkedin: ['uk', 'it', 'de', 'nl', 'dk'],
  jooble: ['uk', 'it', 'de', 'nl', 'dk'],
  serper: ['uk', 'it', 'de', 'nl', 'dk'],
};

export function sourceSupportsCountry(sourceName, country) {
  const supported = SOURCE_COUNTRIES[sourceName] ?? ['uk'];
  return supported.includes(country ?? 'uk');
}

export function jobMatchesSearch(job, search) {
  const haystack = [job.title, job.company, job.location, job.description]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (search.contract_only && !job.isContract) {
    return false;
  }

  if ((search.exclude_keywords ?? []).some((keyword) => haystack.includes(String(keyword).toLowerCase()))) {
    return false;
  }

  if (!jobMatchesCountry(job, search.country)) {
    return false;
  }

  return true;
}

export function sourceAllowed(search, sourceName) {
  if (!(search.allowed_sources ?? []).includes(sourceName)) {
    return false;
  }
  return sourceSupportsCountry(sourceName, search.country);
}
