import axios from 'axios';
import { appConfig, env } from '../config.js';
import { withRetry } from '../utils/http.js';
import { buildSalaryInfo } from '../utils/salary.js';

const cache = new Map();
const baseUrl = 'https://google.serper.dev/jobs';

function getCacheKey(search) {
  return `${search.keywords}::${search.location}`;
}

export const serperSource = {
  name: 'serper',
  isConfigured() {
    return Boolean(env.serperApiKey);
  },
  async fetchJobs(search) {
    const key = getCacheKey(search);
    const cached = cache.get(key);
    const ttlMs = env.serperCacheMinutes * 60 * 1000;

    if (cached && Date.now() - cached.timestamp < ttlMs) {
      return cached.jobs.map((job) => ({
        ...job,
        searchId: search.id,
      }));
    }

    const response = await withRetry(
      () => axios.post(
        baseUrl,
        {
          q: search.query,
          location: search.source_options?.serper?.location ?? `${search.location}, UK`,
          gl: search.source_options?.serper?.gl ?? 'uk',
        },
        {
          timeout: appConfig.requestTimeoutMs,
          headers: {
            'X-API-KEY': env.serperApiKey,
            'Content-Type': 'application/json',
          },
        }
      ),
      {
        source: 'serper',
        searchId: search.id,
      }
    );

    const jobs = (response.data?.jobs ?? []).map((item) => {
      const salaryInfo = buildSalaryInfo({
        title: item.title,
        description: [item.description, item.via].filter(Boolean).join(' '),
        extensions: item.extensions ?? [],
      });

      return {
        externalId: item.link ?? `${item.title}-${item.companyName}`,
        source: 'serper',
        title: item.title,
        company: item.companyName ?? item.via ?? 'Unknown company',
        location: item.location ?? search.location,
        salaryMin: salaryInfo.salaryMin,
        salaryMax: salaryInfo.salaryMax,
        salaryText: salaryInfo.salaryText,
        isContract: salaryInfo.isContract,
        url: item.link,
        postedAt: null,
        searchId: search.id,
        description: [item.description, ...(item.extensions ?? [])].filter(Boolean).join(' | '),
      };
    });

    cache.set(key, {
      timestamp: Date.now(),
      jobs,
    });

    return jobs.map((job) => ({
      ...job,
      searchId: search.id,
    }));
  },
};
