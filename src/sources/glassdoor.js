import axios from 'axios';
import { appConfig, env } from '../config.js';
import { withRetry } from '../utils/http.js';
import { buildSalaryInfo } from '../utils/salary.js';
import { isRelevantJob } from '../utils/relevance.js';
import { logger } from '../utils/logger.js';

function normalizeListing(raw, search) {
  const title = raw?.jobTitle ?? raw?.title ?? '';
  const company = raw?.employerName ?? raw?.employer?.name ?? '';
  const location = raw?.locationName ?? raw?.location ?? '';
  const salaryText = typeof raw?.salary === 'string' ? raw.salary : '';
  const url = raw?.jobViewUrl ?? raw?.url ?? '';
  const postedRaw = raw?.listingDate ?? raw?.postedDate ?? '';

  let postedAt = null;
  if (postedRaw) {
    try {
      postedAt = new Date(postedRaw).toISOString();
    } catch {
      // ignore
    }
  }

  const externalId = String(raw?.jobListingId ?? raw?.id ?? url ?? `${title}-${company}`);

  const descriptionParts = [salaryText, raw?.snippet].filter(Boolean);

  return {
    externalId,
    title: String(title),
    company: String(company || 'Unknown company'),
    location: location || search.location,
    url,
    postedAt,
    description: descriptionParts.join('\n'),
  };
}

export const glassdoorSource = {
  name: 'glassdoor',
  isConfigured() {
    return Boolean(env.glassdoorPartnerId && env.glassdoorPartnerKey);
  },
  async fetchJobs(search) {
    const resp = await withRetry(
      () => axios.get('https://api.glassdoor.com/api/api.htm', {
        params: {
          v: '1',
          format: 'json',
          action: 'jobs',
          countryId: '3',
          q: search.query,
          l: search.location,
          partnerId: env.glassdoorPartnerId,
          partnerKey: env.glassdoorPartnerKey,
        },
        timeout: appConfig.requestTimeoutMs,
      }),
      { source: 'glassdoor', searchId: search.id }
    );

    const payload = resp.data?.response ?? resp.data;
    const rawList = payload?.jobListings
      ?? payload?.jobs
      ?? payload?.results
      ?? [];

    const listings = Array.isArray(rawList) ? rawList : [];

    const jobs = [];

    for (const raw of listings) {
      const normalized = normalizeListing(raw, search);
      const { title, description } = normalized;

      if (!title) continue;

      if (!isRelevantJob(title, description)) {
        logger.debug('Glassdoor job filtered by relevance', { title, searchId: search.id });
        continue;
      }

      const salaryInfo = buildSalaryInfo({
        title,
        description,
      });

      jobs.push({
        externalId: normalized.externalId,
        source: 'glassdoor',
        title,
        company: normalized.company,
        location: normalized.location,
        salaryMin: salaryInfo.salaryMin,
        salaryMax: salaryInfo.salaryMax,
        salaryText: salaryInfo.salaryText,
        isContract: salaryInfo.isContract,
        url: normalized.url || null,
        postedAt: normalized.postedAt,
        searchId: search.id,
        description,
      });
    }

    logger.debug('Glassdoor jobs fetched', { searchId: search.id, count: jobs.length });
    return jobs;
  },
};
