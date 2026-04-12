import axios from 'axios';
import { appConfig } from '../config.js';
import { withRetry } from '../utils/http.js';
import { buildSalaryInfo } from '../utils/salary.js';
import { isRelevantJob } from '../utils/relevance.js';
import { logger } from '../utils/logger.js';

// public.api.careerjet.co.uk has been decommissioned (DNS no longer resolves).
// Set CAREERJET_ENABLED=true in .env to re-enable if a working endpoint is found.
const baseUrl = 'https://public.api.careerjet.co.uk/search';

export const careerjetSource = {
  name: 'careerjet',
  isConfigured() {
    return String(process.env.CAREERJET_ENABLED ?? 'false').toLowerCase() === 'true';
  },
  async fetchJobs(search) {
    const response = await withRetry(
      () => axios.get(baseUrl, {
        timeout: appConfig.requestTimeoutMs,
        params: {
          keywords: search.query,
          location: search.location,
          affid: 'jobbot',
          page: 1,
          pagesize: 25,
        },
      }),
      { source: 'careerjet', searchId: search.id }
    );

    const jobs = [];

    for (const item of (response.data?.jobs ?? [])) {
      const title = item.title ?? '';
      const description = item.description ?? '';

      if (!isRelevantJob(title, description)) {
        logger.debug('Careerjet job filtered by relevance', { title, searchId: search.id });
        continue;
      }

      const salaryInfo = buildSalaryInfo({ title, description });

      let postedAt = null;
      if (item.date) {
        try {
          postedAt = new Date(item.date).toISOString();
        } catch {
          // ignore unparseable dates
        }
      }

      jobs.push({
        externalId: item.url ?? `${title}-${item.company}`,
        source: 'careerjet',
        title,
        company: item.company ?? 'Unknown company',
        location: item.locations ?? search.location,
        salaryMin: salaryInfo.salaryMin,
        salaryMax: salaryInfo.salaryMax,
        salaryText: salaryInfo.salaryText,
        isContract: salaryInfo.isContract,
        url: item.url,
        postedAt,
        searchId: search.id,
        description,
      });
    }

    logger.debug('Careerjet jobs fetched', { searchId: search.id, count: jobs.length });
    return jobs;
  },
};
