import axios from 'axios';
import { appConfig } from '../config.js';
import { withRetry } from '../utils/http.js';
import { buildSalaryInfo } from '../utils/salary.js';
import { isRelevantJob } from '../utils/relevance.js';
import { logger } from '../utils/logger.js';

const baseUrl = 'https://www.morson.com/jobs';
const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function pickKeyword(search) {
  const first = Array.isArray(search.keywords) ? search.keywords[0] : null;
  return (first && first.trim()) || search.query || '';
}

function stripHtml(html) {
  return String(html ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildSearchUrl(search) {
  const params = new URLSearchParams({
    sort_by: 'relevance',
    location: search.location,
    keywords: pickKeyword(search),
  });
  return `${baseUrl}?${params.toString()}`;
}

function extractItemListJobs(html) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  for (const [, body] of blocks) {
    try {
      const data = JSON.parse(body);
      if (data?.['@type'] === 'ItemList' && Array.isArray(data.itemListElement)) {
        return data.itemListElement;
      }
    } catch {
      // try next block
    }
  }
  return [];
}

function locationFromPosting(posting) {
  const place = posting?.jobLocation;
  if (Array.isArray(place)) {
    return place.map((p) => p?.name ?? p?.address?.addressLocality).filter(Boolean).join(', ');
  }
  return place?.name
    ?? place?.address?.addressLocality
    ?? place?.address?.addressRegion
    ?? '';
}

function salaryTextFromPosting(posting) {
  const salary = posting?.baseSalary?.value;
  if (!salary) return '';
  if (typeof salary === 'string') return salary;
  const min = salary.minValue ?? salary.value;
  const max = salary.maxValue;
  const unit = salary.unitText ?? '';
  if (min && max && min !== max) return `${min} - ${max} ${unit}`.trim();
  if (min) return `${min} ${unit}`.trim();
  return '';
}

export const morsonSource = {
  name: 'morson',
  isConfigured() {
    return String(process.env.MORSON_ENABLED ?? 'true').toLowerCase() !== 'false';
  },
  async fetchJobs(search) {
    const url = buildSearchUrl(search);

    let html;
    try {
      const response = await withRetry(
        () => axios.get(url, {
          timeout: appConfig.requestTimeoutMs,
          headers: {
            Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-GB,en;q=0.9',
            'User-Agent': userAgent,
          },
          responseType: 'text',
        }),
        { source: 'morson', searchId: search.id },
      );
      html = response.data ?? '';
    } catch (err) {
      logger.warn('Morson fetch failed', { searchId: search.id, message: err.message });
      return [];
    }

    const rawJobs = extractItemListJobs(html);
    const jobs = [];

    for (const posting of rawJobs) {
      const title = String(posting?.title ?? '').trim();
      if (!title) continue;

      const description = stripHtml(posting?.description ?? '');
      const location = locationFromPosting(posting) || search.location;
      const salaryText = salaryTextFromPosting(posting);
      const jobUrl = typeof posting?.identifier === 'string'
        ? posting.identifier
        : posting?.url ?? null;
      const company = posting?.hiringOrganization?.name ?? 'Morson Group';
      const employmentType = posting?.employmentType ?? '';

      if (!isRelevantJob(title, description)) {
        logger.debug('Morson job filtered by relevance', { title, searchId: search.id });
        continue;
      }

      const salaryInfo = buildSalaryInfo({
        title,
        description: [description, salaryText].filter(Boolean).join(' | '),
      });

      let postedAt = null;
      if (posting?.datePosted) {
        try {
          postedAt = new Date(posting.datePosted).toISOString();
        } catch {
          // ignore
        }
      }

      const externalId = jobUrl?.split('/').filter(Boolean).pop() ?? `${title}-${location}`;

      jobs.push({
        externalId,
        source: 'morson',
        title,
        company,
        location,
        salaryMin: salaryInfo.salaryMin,
        salaryMax: salaryInfo.salaryMax,
        salaryText: salaryInfo.salaryText || salaryText,
        isContract: salaryInfo.isContract || /contract/i.test(employmentType),
        url: jobUrl || url,
        postedAt,
        searchId: search.id,
        description: description || [title, location, salaryText].filter(Boolean).join(' | '),
      });
    }

    logger.debug('Morson jobs fetched', { searchId: search.id, count: jobs.length });
    return jobs;
  },
};
