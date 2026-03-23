import axios from 'axios';
import { appConfig, env } from '../config.js';
import { withRetry } from '../utils/http.js';
import { buildSalaryInfo } from '../utils/salary.js';
import { isRelevantJob } from '../utils/relevance.js';
import { logger } from '../utils/logger.js';

const baseUrl = 'https://www.reed.co.uk/api/1.0/search';

export const reedSource = {
  name: 'reed',
  isConfigured() {
    return Boolean(env.reedApiKey);
  },
  async fetchJobs(search) {
    const response = await withRetry(
      () => axios.get(baseUrl, {
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
          resultsToTake: 25,
        },
      }),
      {
        source: 'reed',
        searchId: search.id,
      }
    );

    const jobs = [];

    for (const item of (response.data?.results ?? [])) {
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

    return jobs;
  },
};
