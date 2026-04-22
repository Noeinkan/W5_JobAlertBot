import axios from 'axios';
import { appConfig } from '../config.js';
import { withRetry } from '../utils/http.js';
import { buildSalaryInfo } from '../utils/salary.js';
import { isRelevantJob } from '../utils/relevance.js';
import { logger } from '../utils/logger.js';

const baseUrl = 'https://www.risetechnical.com/jobs';

const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const cardSplitRe = /<li class='job-result-item'[^>]*>/g;
const titleLinkRe = /<div class='job-title'>\s*<a href="(\/job\/[^"]+)">([\s\S]*?)<\/a>/;
const locationRe = /<li class='results-job-location'>([\s\S]*?)<\/li>/;
const salaryRe = /<li class='results-salary'>([\s\S]*?)<\/li>/;
const postedRe = /<li class='results-posted-at'>([\s\S]*?)<\/li>/;
const descriptionRe = /<p class='job-description'>([\s\S]*?)<\/p>/;

function stripHtml(html) {
  return String(html ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function extractId(url) {
  const match = String(url).match(/-(\d+)(?:\/|$)/);
  return match ? match[1] : null;
}

// Rise Technical search does not understand " OR " — pass the single strongest term.
function pickKeyword(search) {
  const first = Array.isArray(search.keywords) ? search.keywords[0] : null;
  return (first && first.trim()) || search.query || '';
}

function buildSearchUrl(search) {
  const params = new URLSearchParams({ query: pickKeyword(search) });
  return `${baseUrl}?${params.toString()}`;
}

export const risetechnicalSource = {
  name: 'risetechnical',
  isConfigured() {
    return String(process.env.RISETECHNICAL_ENABLED ?? 'true').toLowerCase() !== 'false';
  },
  async fetchJobs(search) {
    const url = buildSearchUrl(search);

    let html;
    try {
      const response = await withRetry(
        () => axios.get(url, {
          timeout: appConfig.requestTimeoutMs,
          headers: {
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-GB,en;q=0.9',
            'User-Agent': userAgent,
          },
          responseType: 'text',
        }),
        { source: 'risetechnical', searchId: search.id }
      );
      html = response.data ?? '';
    } catch (err) {
      logger.warn('Rise Technical fetch failed', { searchId: search.id, message: err.message });
      return [];
    }

    const jobs = [];
    const segments = html.split(cardSplitRe).slice(1);

    for (const block of segments) {
      const title = titleLinkRe.exec(block);
      if (!title) continue;

      const relativeUrl = title[1];
      const titleText = stripHtml(title[2]);
      const jobUrl = `https://www.risetechnical.com${relativeUrl}`;
      const externalId = extractId(relativeUrl) ?? jobUrl;

      const location = stripHtml(locationRe.exec(block)?.[1] ?? '') || search.location;
      const salaryText = stripHtml(salaryRe.exec(block)?.[1] ?? '');
      const postedText = stripHtml(postedRe.exec(block)?.[1] ?? '');
      const description = stripHtml(descriptionRe.exec(block)?.[1] ?? '');

      if (!titleText) continue;

      if (!isRelevantJob(titleText, description)) {
        logger.debug('Rise Technical job filtered by relevance', { title: titleText, searchId: search.id });
        continue;
      }

      const salaryInfo = buildSalaryInfo({
        title: titleText,
        description: [description, salaryText].filter(Boolean).join(' | '),
      });

      jobs.push({
        externalId,
        source: 'risetechnical',
        title: titleText,
        company: 'Rise Technical',
        location,
        salaryMin: salaryInfo.salaryMin,
        salaryMax: salaryInfo.salaryMax,
        salaryText: salaryInfo.salaryText,
        isContract: salaryInfo.isContract,
        url: jobUrl,
        postedAt: null,
        searchId: search.id,
        description: [description, postedText].filter(Boolean).join(' | '),
      });
    }

    logger.debug('Rise Technical jobs fetched', { searchId: search.id, count: jobs.length });
    return jobs;
  },
};
