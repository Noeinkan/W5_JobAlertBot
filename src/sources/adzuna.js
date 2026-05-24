import axios from 'axios';
import { appConfig, env } from '../config.js';
import { withRetry } from '../utils/http.js';
import { getCountryConfig } from '../utils/countries.js';
import { buildSalaryInfo } from '../utils/salary.js';
import { isRelevantJob } from '../utils/relevance.js';
import { logger } from '../utils/logger.js';
import { maxRawListingsPerQuery } from '../utils/sourcePagination.js';

const RESULTS_PER_PAGE = 50;

function buildAdzunaParams(search) {
  const keywords = Array.isArray(search.keywords) ? search.keywords.filter(Boolean) : [];
  const excludeKeywords = Array.isArray(search.exclude_keywords) ? search.exclude_keywords.filter(Boolean) : [];
  const params = {
    app_id: env.adzunaAppId,
    app_key: env.adzunaAppKey,
    where: search.location,
    salary_min: search.min_salary ?? undefined,
    category: search.category ?? search.source_options?.adzuna?.category ?? undefined,
    results_per_page: RESULTS_PER_PAGE,
    sort_by: 'date',
  };

  if (keywords.length <= 1) {
    params.what = keywords[0] ?? search.query;
  } else {
    params.what_or = keywords.join(',');
  }

  if (excludeKeywords.length > 0) {
    params.what_exclude = excludeKeywords.join(',');
  }

  return params;
}

export const adzunaSource = {
  name: 'adzuna',
  isConfigured() {
    return Boolean(env.adzunaAppId && env.adzunaAppKey);
  },
  async fetchJobs(search) {
    const maxRaw = maxRawListingsPerQuery();
    const jobs = [];
    let fetched = 0;

    const countryCode = getCountryConfig(search.country).adzunaCode ?? 'gb';

    for (let page = 1; fetched < maxRaw; page++) {
      const url = `https://api.adzuna.com/v1/api/jobs/${countryCode}/search/${page}`;
      const response = await withRetry(
        () =>
          axios.get(url, {
            timeout: appConfig.requestTimeoutMs,
            params: buildAdzunaParams(search),
          }),
        {
          source: 'adzuna',
          searchId: search.id,
        }
      );

      const batch = response.data?.results ?? [];
      if (batch.length === 0) break;

      for (const item of batch) {
        const title = item.title ?? '';
        const description = item.description ?? '';

        if (!isRelevantJob(title, description)) {
          logger.debug('Adzuna job filtered by relevance', { title, searchId: search.id });
          continue;
        }

        const salaryInfo = buildSalaryInfo({
          title,
          description,
          salaryMin: item.salary_min,
          salaryMax: item.salary_max,
          country: search.country,
        });

        jobs.push({
          externalId: item.id ? String(item.id) : null,
          source: 'adzuna',
          title,
          company: item.company?.display_name ?? 'Unknown company',
          location: item.location?.display_name ?? search.location,
          salaryMin: salaryInfo.salaryMin,
          salaryMax: salaryInfo.salaryMax,
          salaryText: salaryInfo.salaryText,
          isContract: salaryInfo.isContract,
          url: item.redirect_url,
          postedAt: item.created ?? null,
          searchId: search.id,
          description,
        });
      }

      fetched += batch.length;
      if (batch.length < RESULTS_PER_PAGE) break;
    }

    return jobs;
  },
};
