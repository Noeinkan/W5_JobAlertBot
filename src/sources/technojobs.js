import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { appConfig } from '../config.js';
import { withRetry } from '../utils/http.js';
import { buildSalaryInfo } from '../utils/salary.js';
import { isRelevantJob } from '../utils/relevance.js';
import { logger } from '../utils/logger.js';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

function buildFeedUrl(search) {
  const job = search.query.replace(/\s+OR\s+/gi, ' ').trim();
  const params = new URLSearchParams({
    job,
    location: search.location,
  });
  return `https://www.technojobs.co.uk/rss.phtml?${params.toString()}`;
}

function stripHtml(html) {
  return String(html ?? '').replace(/<[^>]+>/g, '').trim();
}

export const technojobsSource = {
  name: 'technojobs',
  isConfigured() {
    return true;
  },
  async fetchJobs(search) {
    const url = buildFeedUrl(search);

    const response = await withRetry(
      () => axios.get(url, {
        timeout: appConfig.requestTimeoutMs,
        headers: {
          Accept: 'application/rss+xml, application/xml, text/xml, */*',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
        responseType: 'text',
      }),
      { source: 'technojobs', searchId: search.id }
    );

    const trimmed = response.data?.trim() ?? '';
    if (!trimmed.startsWith('<?xml') && !trimmed.startsWith('<rss')) {
      logger.warn('Technojobs returned non-RSS response', { searchId: search.id });
      return [];
    }

    const parsed = parser.parse(response.data);
    const rawItems = parsed?.rss?.channel?.item ?? [];
    const items = Array.isArray(rawItems) ? rawItems : [rawItems];

    const jobs = [];

    for (const item of items) {
      const title = stripHtml(item.title ?? '');
      const description = stripHtml(item.description ?? item['content:encoded'] ?? '');

      if (!title) continue;

      if (!isRelevantJob(title, description)) {
        logger.debug('Technojobs job filtered by relevance', { title, searchId: search.id });
        continue;
      }

      const company = stripHtml(item['dc:creator'] ?? item.company ?? '');
      const location = stripHtml(item['job:location'] ?? item.location ?? '') || search.location;
      const salaryInfo = buildSalaryInfo({ title, description });

      let postedAt = null;
      if (item.pubDate) {
        try {
          postedAt = new Date(item.pubDate).toISOString();
        } catch {
          // ignore
        }
      }

      jobs.push({
        externalId: item.guid ?? item.link ?? `${title}-${company}`,
        source: 'technojobs',
        title,
        company: company || 'Unknown company',
        location,
        salaryMin: salaryInfo.salaryMin,
        salaryMax: salaryInfo.salaryMax,
        salaryText: salaryInfo.salaryText,
        isContract: salaryInfo.isContract,
        url: item.link ?? null,
        postedAt,
        searchId: search.id,
        description,
      });
    }

    logger.debug('Technojobs jobs fetched', { searchId: search.id, count: jobs.length });
    return jobs;
  },
};
