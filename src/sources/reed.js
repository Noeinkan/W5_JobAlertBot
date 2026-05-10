import axios from 'axios';
import { appConfig, env } from '../config.js';
import { withRetry } from '../utils/http.js';
import { buildSalaryInfo } from '../utils/salary.js';
import { isRelevantJob } from '../utils/relevance.js';
import { logger } from '../utils/logger.js';
import { maxRawListingsPerQuery } from '../utils/sourcePagination.js';

const baseUrl = 'https://www.reed.co.uk/api/1.0/search';

/** Reed allows up to 100 results per request (see Reed Jobseeker API). */
const REED_PAGE_SIZE = 100;

export const reedSource = {
  name: 'reed',
  isConfigured() {
    return Boolean(env.reedApiKey);
  },
  async fetchJobs(search) {
    const maxRaw = maxRawListingsPerQuery();
    const jobs = [];
    let skip = 0;

    while (skip < maxRaw) {
      const take = Math.min(REED_PAGE_SIZE, maxRaw - skip);
      const response = await withRetry(
        () =>
          axios.get(baseUrl, {
            timeout: appConfig.requestTimeoutMs,
            auth: {
              username: env.reedApiKey,
              password: '',
            },
            params: {
              keywords: search.query,
              locationName: search.location,
              distanceFromLocation: search.distance_from_location,
              minimumSalary: search.min_salary ?? undefined,
              sectorId: search.source_options?.reed?.sectorId ?? undefined,
              resultsToTake: take,
              resultsToSkip: skip,
            },
          }),
        {
          source: 'reed',
          searchId: search.id,
        }
      );

      const batch = response.data?.results ?? [];
      if (batch.length === 0) break;

      for (const item of batch) {
        const title = item.jobTitle ?? '';
        const description = item.jobDescription ?? '';

        if (!isRelevantJob(title, description)) {
          logger.debug('Reed job filtered by relevance', { title, searchId: search.id });
          continue;
        }

        const salaryInfo = buildSalaryInfo({
          title,
          description,
          salaryMin: item.minimumSalary,
          salaryMax: item.maximumSalary,
        });

        jobs.push({
          externalId: item.jobId ? String(item.jobId) : null,
          source: 'reed',
          title,
          company: item.employerName ?? 'Via Reed',
          location: item.locationName ?? search.location,
          salaryMin: salaryInfo.salaryMin,
          salaryMax: salaryInfo.salaryMax,
          salaryText: salaryInfo.salaryText,
          isContract: salaryInfo.isContract,
          url: item.jobUrl,
          postedAt: item.date ?? null,
          searchId: search.id,
          description,
        });
      }

      skip += batch.length;
      if (batch.length < take) break;
    }

    return jobs;
  },
};
