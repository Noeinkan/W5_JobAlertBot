import axios from 'axios';
import { appConfig, env } from '../config.js';
import { withRetry } from '../utils/http.js';
import { buildSalaryInfo } from '../utils/salary.js';

const baseUrl = 'https://api.adzuna.com/v1/api/jobs/gb/search/1';

export const adzunaSource = {
  name: 'adzuna',
  isConfigured() {
    return Boolean(env.adzunaAppId && env.adzunaAppKey);
  },
  async fetchJobs(search) {
    const response = await withRetry(
      () => axios.get(baseUrl, {
        timeout: appConfig.requestTimeoutMs,
        params: {
          app_id: env.adzunaAppId,
          app_key: env.adzunaAppKey,
          what: search.query,
          where: search.location,
          salary_min: search.min_salary ?? undefined,
          category: search.source_options?.adzuna?.category ?? undefined,
          results_per_page: 20,
          sort_by: 'date',
          content_type: 'application/json',
        },
      }),
      {
        source: 'adzuna',
        searchId: search.id,
      }
    );

    return (response.data?.results ?? []).map((item) => {
      const salaryInfo = buildSalaryInfo({
        title: item.title,
        description: item.description,
        salaryMin: item.salary_min,
        salaryMax: item.salary_max,
      });

      return {
        externalId: item.id ? String(item.id) : null,
        source: 'adzuna',
        title: item.title,
        company: item.company?.display_name ?? 'Unknown company',
        location: item.location?.display_name ?? search.location,
        salaryMin: salaryInfo.salaryMin,
        salaryMax: salaryInfo.salaryMax,
        salaryText: salaryInfo.salaryText,
        isContract: salaryInfo.isContract,
        url: item.redirect_url,
        postedAt: item.created ?? null,
        searchId: search.id,
        description: item.description ?? '',
      };
    });
  },
};
