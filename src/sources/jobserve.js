import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { appConfig } from '../config.js';
import { withRetry } from '../utils/http.js';
import { buildSalaryInfo } from '../utils/salary.js';
import { isRelevantJob } from '../utils/relevance.js';
import { logger } from '../utils/logger.js';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

// JobServe moved their search URL from /JobSearch/ to /job-search/ around 2025.
// The RSS feed (RSS=1) may require a UK IP to return XML rather than HTML.
// Set JOBSERVE_ENABLED=false in .env to disable if the feed is unavailable.
function buildFeedUrl(search) {
  const params = new URLSearchParams({
    Keywords: search.query,
    Location: search.location,
    Radius: '30',
    RSS: '1',
  });
  return `https://www.jobserve.com/gb/en/job-search/?${params.toString()}`;
}

function stripHtml(html) {
  return String(html ?? '').replace(/<[^>]+>/g, '').trim();
}

export const jobserveSource = {
  name: 'jobserve',
  isConfigured() {
    return String(process.env.JOBSERVE_ENABLED ?? 'true').toLowerCase() !== 'false';
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
      { source: 'jobserve', searchId: search.id }
    );

    // If the response is HTML (not RSS XML), return empty rather than throwing.
    if (!response.data?.trim().startsWith('<?xml') && !response.data?.trim().startsWith('<rss')) {
      logger.warn('JobServe returned non-RSS response (HTML?). URL may need updating or a UK IP.', { searchId: search.id });
      return [];
    }

    const parsed = parser.parse(response.data);
    const rawItems = parsed?.rss?.channel?.item ?? [];
    const items = Array.isArray(rawItems) ? rawItems : [rawItems];

    const jobs = [];

    for (const item of items) {
      const title = stripHtml(item.title ?? '');
      const description = stripHtml(item.description ?? '');

      if (!title) continue;

      if (!isRelevantJob(title, description)) {
        logger.debug('JobServe job filtered by relevance', { title, searchId: search.id });
        continue;
      }

      const company = stripHtml(item['jobserve:Company'] ?? item['company'] ?? '');
      const location = stripHtml(item['jobserve:Location'] ?? item['location'] ?? search.location);
      const salaryRaw = stripHtml(item['jobserve:Salary'] ?? item['salary'] ?? '');
      const salaryInfo = buildSalaryInfo({ title, description: [description, salaryRaw].filter(Boolean).join(' ') });

      let postedAt = null;
      if (item.pubDate) {
        try {
          postedAt = new Date(item.pubDate).toISOString();
        } catch {
          // ignore
        }
      }

      jobs.push({
        externalId: item.link ?? item.guid ?? `${title}-${company}`,
        source: 'jobserve',
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

    logger.debug('JobServe jobs fetched', { searchId: search.id, count: jobs.length });
    return jobs;
  },
};
