import axios from 'axios';
import { appConfig, env } from '../config.js';
import { withRetry } from '../utils/http.js';
import { getCountryConfig, textMentionsCountry } from '../utils/countries.js';
import { buildSalaryInfo } from '../utils/salary.js';
import { isRelevantJob } from '../utils/relevance.js';
import { logger } from '../utils/logger.js';
import { maxRawListingsPerQuery } from '../utils/sourcePagination.js';

const cache = new Map();
const baseUrl = 'https://google.serper.dev/search';

function getCacheKey(search) {
  return `${search.country ?? 'uk'}::${search.keywords}::${search.location}`;
}

function serperGeoParams(search) {
  const countryConfig = getCountryConfig(search.country);
  const overrideLocation = search.source_options?.serper?.location;

  if (overrideLocation) {
    return {
      location: overrideLocation,
      gl: search.source_options?.serper?.gl ?? countryConfig.serperGl,
      hl: search.source_options?.serper?.hl ?? countryConfig.serperHl,
    };
  }

  const baseLocation = String(search.location ?? '').trim();
  const location = !baseLocation
    ? countryConfig.serperLocation
    : textMentionsCountry(baseLocation, search.country)
      ? baseLocation
      : `${baseLocation}, ${countryConfig.serperLocation}`;

  return {
    location,
    gl: search.source_options?.serper?.gl ?? countryConfig.serperGl,
    hl: search.source_options?.serper?.hl ?? countryConfig.serperHl,
  };
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

    const maxRaw = maxRawListingsPerQuery();
    const mergedByLink = new Map();
    let apiRows = 0;

    const geo = serperGeoParams(search);
  const jobsTerm = search.source_options?.serper?.jobs_term ?? getCountryConfig(search.country).serperJobsTerm;

    for (let page = 1; apiRows < maxRaw && page <= 40; page++) {
      const response = await withRetry(
        () =>
          axios.post(
            baseUrl,
            {
              q: `${search.query} ${jobsTerm}`,
              location: geo.location,
              gl: geo.gl,
              hl: geo.hl,
              page,
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

      const batch = response.data?.jobs ?? [];
      if (batch.length === 0) break;

      const beforeSize = mergedByLink.size;
      for (let i = 0; i < batch.length; i++) {
        const item = batch[i];
        const lk = item.link;
        const key = lk || `serper-${page}-${i}-${item.title ?? ''}`;
        if (!mergedByLink.has(key)) mergedByLink.set(key, item);
      }

      apiRows += batch.length;
      if (mergedByLink.size === beforeSize) break;
      if (batch.length < 8) break;
    }

    const jobs = [];

    for (const item of mergedByLink.values()) {
      const title = item.title ?? '';
      const description = [item.description, ...(item.extensions ?? [])].filter(Boolean).join(' | ');

      if (!isRelevantJob(title, description)) {
        logger.debug('Serper job filtered by relevance', { title, searchId: search.id });
        continue;
      }

      const salaryInfo = buildSalaryInfo({
        title,
        description: [item.description, item.via].filter(Boolean).join(' '),
        extensions: item.extensions ?? [],
        country: search.country,
      });

      jobs.push({
        externalId: item.link ?? `${title}-${item.companyName}`,
        source: 'serper',
        title,
        company: item.companyName ?? item.via ?? 'Unknown company',
        location: item.location ?? search.location,
        salaryMin: salaryInfo.salaryMin,
        salaryMax: salaryInfo.salaryMax,
        salaryText: salaryInfo.salaryText,
        isContract: salaryInfo.isContract,
        url: item.link,
        postedAt: null,
        searchId: search.id,
        description,
      });
    }

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
