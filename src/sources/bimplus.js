import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { appConfig } from '../config.js';
import { withRetry } from '../utils/http.js';
import { buildSalaryInfo } from '../utils/salary.js';
import { isRelevantJob } from '../utils/relevance.js';
import { logger } from '../utils/logger.js';

const primaryFeed = 'https://www.bimplus.co.uk/jobs/feed/';
const fallbackFeed = 'https://www.bimplus.co.uk/feed/?post_type=job_listing';
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

function stripHtml(html) {
  return String(html ?? '').replace(/<[^>]+>/g, '').trim();
}

function parseItems(xml) {
  const parsed = parser.parse(xml);
  const rawItems = parsed?.rss?.channel?.item ?? [];
  return Array.isArray(rawItems) ? rawItems : [rawItems];
}

export const bimplusSource = {
  name: 'bimplus',
  isConfigured() {
    return true;
  },
  async fetchJobs(search) {
    let xml;

    try {
      const response = await withRetry(
        () => axios.get(primaryFeed, {
          timeout: appConfig.requestTimeoutMs,
          headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
          responseType: 'text',
        }),
        { source: 'bimplus', searchId: search.id }
      );
      xml = response.data;
    } catch (err) {
      logger.warn('BIM+ primary feed failed', { searchId: search.id, message: err.message });
      xml = null;
    }

    let items = xml ? parseItems(xml) : [];

    if (!items.length) {
      try {
        const response = await withRetry(
          () => axios.get(fallbackFeed, {
            timeout: appConfig.requestTimeoutMs,
            headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
            responseType: 'text',
          }),
          { source: 'bimplus', searchId: search.id }
        );
        items = parseItems(response.data);
      } catch (err) {
        logger.warn('BIM+ fallback feed failed', { searchId: search.id, message: err.message });
        return [];
      }
    }

    const queryTerms = search.keywords.map((kw) => kw.toLowerCase());
    const jobs = [];

    for (const item of items) {
      const title = stripHtml(item.title ?? '');
      const description = stripHtml(item.description ?? item['content:encoded'] ?? '');

      if (!title) continue;

      const combined = `${title} ${description}`.toLowerCase();
      if (!queryTerms.some((kw) => combined.includes(kw.replace(/"/g, '')))) {
        continue;
      }

      if (!isRelevantJob(title, description)) {
        logger.debug('BIM+ job filtered by relevance', { title, searchId: search.id });
        continue;
      }

      const locNs = item['job_listing:location'] ?? item.location ?? '';
      const location = stripHtml(typeof locNs === 'object' ? locNs['#text'] ?? locNs : locNs) || search.location;
      const company = stripHtml(item['dc:creator'] ?? item['job_listing:company'] ?? '');
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
        source: 'bimplus',
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

    logger.debug('BIM+ jobs fetched', { searchId: search.id, count: jobs.length });
    return jobs;
  },
};
