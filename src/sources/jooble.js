import axios from 'axios';
import { appConfig, env } from '../config.js';
import { withRetry } from '../utils/http.js';
import { buildSalaryInfo } from '../utils/salary.js';
import { isRelevantJob } from '../utils/relevance.js';
import { logger } from '../utils/logger.js';
import { maxRawListingsPerQuery } from '../utils/sourcePagination.js';

const baseUrl = 'https://jooble.org/api';

export const joobleSource = {
  name: 'jooble',
  isConfigured() {
    return Boolean(env.joobleApiKey);
  },
  async fetchJobs(search) {
    const maxRaw = maxRawListingsPerQuery();
    const dedupe = new Set();
    const jobs = [];
    let rawSeen = 0;

    for (let page = 1; rawSeen < maxRaw && page <= 50; page++) {
      const response = await withRetry(
        () =>
          axios.post(
            `${baseUrl}/${env.joobleApiKey}`,
            {
              keywords: search.query,
              location: search.location,
              page,
            },
            {
              timeout: appConfig.requestTimeoutMs,
              headers: { 'Content-Type': 'application/json' },
            }
          ),
        { source: 'jooble', searchId: search.id }
      );

      const batch = response.data?.jobs ?? [];
      if (batch.length === 0) break;

      rawSeen += batch.length;

      for (const item of batch) {
        const link = item.link ?? '';
        const dedupeKey = link || `${item.title ?? ''}-${item.company ?? ''}-${page}`;
        if (dedupe.has(dedupeKey)) continue;
        dedupe.add(dedupeKey);

        const title = item.title ?? '';
        const description = item.snippet ?? '';

        if (!isRelevantJob(title, description)) {
          logger.debug('Jooble job filtered by relevance', { title, searchId: search.id });
          continue;
        }

        const salaryInfo = buildSalaryInfo({ title, description, country: search.country });

        jobs.push({
          externalId: item.link ?? `${title}-${item.company}`,
          source: 'jooble',
          title,
          company: item.company ?? 'Unknown company',
          location: item.location ?? search.location,
          salaryMin: salaryInfo.salaryMin,
          salaryMax: salaryInfo.salaryMax,
          salaryText: salaryInfo.salaryText,
          isContract: salaryInfo.isContract,
          url: item.link,
          postedAt: item.updated ? new Date(item.updated).toISOString() : null,
          searchId: search.id,
          description,
        });
      }

      if (batch.length < 15) break;
    }

    logger.debug('Jooble jobs fetched', { searchId: search.id, count: jobs.length });
    return jobs;
  },
};
