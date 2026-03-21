import axios from 'axios';
import { appConfig, env } from '../config.js';
import { withRetry } from '../utils/http.js';
import { buildSalaryInfo } from '../utils/salary.js';

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
          resultsToTake: 25,
        },
      }),
      {
        source: 'reed',
        searchId: search.id,
      }
    );

    return (response.data?.results ?? []).map((item) => {
      const salaryInfo = buildSalaryInfo({
        title: item.jobTitle,
        description: item.jobDescription,
        salaryMin: item.minimumSalary,
        salaryMax: item.maximumSalary,
      });

      return {
        externalId: item.jobId ? String(item.jobId) : null,
        source: 'reed',
        title: item.jobTitle,
        company: item.employerName ?? 'Via Reed',
        location: item.locationName ?? search.location,
        salaryMin: salaryInfo.salaryMin,
        salaryMax: salaryInfo.salaryMax,
        salaryText: salaryInfo.salaryText,
        isContract: salaryInfo.isContract,
        url: item.jobUrl,
        postedAt: item.date ?? null,
        searchId: search.id,
        description: item.jobDescription ?? '',
      };
    });
  },
};
