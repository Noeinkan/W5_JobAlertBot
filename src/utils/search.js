/**
 * Country coverage per source. Sources not listed default to UK-only.
 * Italian market reuses the 4 multi-country adapters that can be parameterized
 * by country code or location string (adzuna, linkedin, jooble, serper).
 */
const SOURCE_COUNTRIES = {
  adzuna: ['uk', 'it'],
  linkedin: ['uk', 'it'],
  jooble: ['uk', 'it'],
  serper: ['uk', 'it'],
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

  return true;
}

export function sourceAllowed(search, sourceName) {
  if (!(search.allowed_sources ?? []).includes(sourceName)) {
    return false;
  }
  return sourceSupportsCountry(sourceName, search.country);
}
