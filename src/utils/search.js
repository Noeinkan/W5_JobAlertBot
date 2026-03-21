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
  return (search.allowed_sources ?? []).includes(sourceName);
}
