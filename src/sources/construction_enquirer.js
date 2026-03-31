import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { appConfig } from '../config.js';
import { withRetry } from '../utils/http.js';
import { buildSalaryInfo } from '../utils/salary.js';
import { isRelevantJob } from '../utils/relevance.js';
import { logger } from '../utils/logger.js';

const feedUrl = 'https://www.constructionenquirer.com/jobs/feed/';
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

function stripHtml(html) {
  return String(html ?? '').replace(/<[^>]+>/g, '').trim();
}

export const constructionEnquirerSource = {
  name: 'construction_enquirer',
  isConfigured() {
    return true;
  },
  async fetchJobs(search) {
    const response = await withRetry(
      () => axios.get(feedUrl, {
        timeout: appConfig.requestTimeoutMs,
        headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
        responseType: 'text',
      }),
      { source: 'construction_enquirer', searchId: search.id }
    );

    const parsed = parser.parse(response.data);
    const rawItems = parsed?.rss?.channel?.item ?? [];
    const items = Array.isArray(rawItems) ? rawItems : [rawItems];

    const queryTerms = search.keywords.map((kw) => kw.toLowerCase());
    const jobs = [];

    for (const item of items) {
      const title = stripHtml(item.title ?? '');
      const description = stripHtml(item.description ?? item['content:encoded'] ?? '');

      if (!title) continue;

      // Construction Enquirer is a single shared feed — filter to this search's keywords
      const combined = `${title} ${description}`.toLowerCase();
      if (!queryTerms.some((kw) => combined.includes(kw.replace(/"/g, '')))) {
        continue;
      }

      if (!isRelevantJob(title, description)) {
        logger.debug('Construction Enquirer job filtered by relevance', { title, searchId: search.id });
        continue;
      }

      const company = stripHtml(item['dc:creator'] ?? '');
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
        externalId: item.link ?? item.guid ?? `${title}-${company}`,
        source: 'construction_enquirer',
        title,
        company: company || 'Unknown company',
        location: search.location,
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

    logger.debug('Construction Enquirer jobs fetched', { searchId: search.id, count: jobs.length });
    return jobs;
  },
};
