import axios from 'axios';
import { appConfig, env } from '../config.js';
import { withRetry } from '../utils/http.js';
import { buildSalaryInfo } from '../utils/salary.js';
import { isRelevantJob } from '../utils/relevance.js';
import { logger } from '../utils/logger.js';

let tokenCache = { token: '', expiresAt: 0 };

async function getAccessToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.token;
  }

  const resp = await withRetry(
    () => axios.post(
      'https://api.monster.com/auth/oauth2/token',
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: env.monsterClientId,
        client_secret: env.monsterClientSecret,
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: appConfig.requestTimeoutMs,
      }
    ),
    { source: 'monster', searchId: 'oauth' }
  );

  const token = resp.data?.access_token;
  const expiresIn = Number(resp.data?.expires_in ?? 3600);

  if (!token) {
    throw new Error('Monster OAuth response missing access_token');
  }

  tokenCache = {
    token,
    expiresAt: Date.now() + Math.max(60, expiresIn) * 1000,
  };

  return token;
}

function normalizeListing(raw, search) {
  const title = raw?.title ?? raw?.jobTitle ?? '';
  const company = raw?.company?.name ?? raw?.companyName ?? raw?.employer ?? '';
  const loc =
    raw?.locations?.[0]?.city
    ?? raw?.location?.city
    ?? raw?.city
    ?? '';
  const salaryMin = raw?.salary?.min ?? raw?.salaryMin;
  const salaryMax = raw?.salary?.max ?? raw?.salaryMax;
  const salaryText = [salaryMin, salaryMax].filter((x) => x != null).join(' — ');
  const url = raw?.landingPageUrl ?? raw?.url ?? raw?.applyUrl ?? '';
  const postedRaw = raw?.datePublished ?? raw?.postedDate ?? '';

  let postedAt = null;
  if (postedRaw) {
    try {
      postedAt = new Date(postedRaw).toISOString();
    } catch {
      // ignore
    }
  }

  const externalId = String(raw?.id ?? raw?.jobId ?? url ?? `${title}-${company}`);

  const descriptionParts = [
    raw?.description,
    salaryText,
  ].filter(Boolean);

  return {
    externalId,
    title: String(title),
    company: String(company || 'Unknown company'),
    location: loc || search.location,
    url,
    postedAt,
    description: descriptionParts.join('\n'),
    salaryHint: salaryText,
  };
}

export const monsterSource = {
  name: 'monster',
  isConfigured() {
    return Boolean(env.monsterClientId && env.monsterClientSecret);
  },
  async fetchJobs(search) {
    const token = await getAccessToken();

    const resp = await withRetry(
      () => axios.get('https://api.monster.com/ads/v1/ads', {
        params: {
          q: search.query,
          where: search.location,
          country: 'gb',
        },
        headers: { Authorization: `Bearer ${token}` },
        timeout: appConfig.requestTimeoutMs,
      }),
      { source: 'monster', searchId: search.id }
    );

    const rawList = resp.data?.ads
      ?? resp.data?.results
      ?? resp.data?.jobAds
      ?? resp.data?.data
      ?? [];

    const listings = Array.isArray(rawList) ? rawList : [];

    const jobs = [];

    for (const raw of listings) {
      const normalized = normalizeListing(raw, search);
      const { title, description } = normalized;

      if (!title) continue;

      if (!isRelevantJob(title, description)) {
        logger.debug('Monster job filtered by relevance', { title, searchId: search.id });
        continue;
      }

      const salaryInfo = buildSalaryInfo({
        title,
        description: [description, normalized.salaryHint].filter(Boolean).join(' '),
      });

      jobs.push({
        externalId: normalized.externalId,
        source: 'monster',
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

    logger.debug('Monster jobs fetched', { searchId: search.id, count: jobs.length });
    return jobs;
  },
};
