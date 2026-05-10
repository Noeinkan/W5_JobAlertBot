import axios from 'axios';
import { appConfig, env } from '../config.js';
import { withRetry } from '../utils/http.js';
import { buildSalaryInfo } from '../utils/salary.js';
import { isRelevantJob } from '../utils/relevance.js';
import { logger } from '../utils/logger.js';
import { maxRawListingsPerQuery } from '../utils/sourcePagination.js';

const baseUrl = 'https://content.guardianapis.com/jobs';
const PAGE_SIZE = 50;

export const guardianSource = {
  name: 'guardian',
  isConfigured() {
    return Boolean(env.guardianApiKey);
  },
  async fetchJobs(search) {
    const maxRaw = maxRawListingsPerQuery();
    const jobs = [];
    let rawSeen = 0;

    for (let page = 1; rawSeen < maxRaw && page <= 50; page++) {
      const response = await withRetry(
        () =>
          axios.get(baseUrl, {
            timeout: appConfig.requestTimeoutMs,
            params: {
              'api-key': env.guardianApiKey,
              q: search.query,
              page,
              'page-size': PAGE_SIZE,
              'show-fields': 'all',
            },
          }),
        { source: 'guardian', searchId: search.id }
      );

      const batch = response.data?.response?.results ?? [];
      if (batch.length === 0) break;

      rawSeen += batch.length;

      for (const item of batch) {
        const title = item.webTitle ?? '';
        const fields = item.fields ?? {};
        const description = fields.trailText ?? '';

        if (!isRelevantJob(title, description)) {
          logger.debug('Guardian job filtered by relevance', { title, searchId: search.id });
          continue;
        }

        const salaryText = fields.salary ?? null;
        const salaryInfo = buildSalaryInfo({ title, description: [description, salaryText].filter(Boolean).join(' ') });

        jobs.push({
          externalId: item.id ?? item.webUrl,
          source: 'guardian',
          title,
          company: fields.employerName ?? 'Unknown company',
          location: fields.locationDescription ?? search.location,
          salaryMin: salaryInfo.salaryMin,
          salaryMax: salaryInfo.salaryMax,
          salaryText: salaryInfo.salaryText ?? salaryText,
          isContract: salaryInfo.isContract,
          url: item.webUrl,
          postedAt: item.webPublicationDate ?? null,
          searchId: search.id,
          description,
        });
      }

      if (batch.length < PAGE_SIZE) break;
    }

    logger.debug('Guardian jobs fetched', { searchId: search.id, count: jobs.length });
    return jobs;
  },
};
