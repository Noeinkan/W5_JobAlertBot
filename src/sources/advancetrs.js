import axios from 'axios';
import { appConfig } from '../config.js';
import { withRetry } from '../utils/http.js';
import { buildSalaryInfo } from '../utils/salary.js';
import { isRelevantJob } from '../utils/relevance.js';
import { logger } from '../utils/logger.js';

const baseUrl = 'https://www.advance-trs.com/jobs/';
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
    Keywords: pickKeyword(search),
    Location: search.location,
    Distance: String(search.distance_from_location ?? 20),
  });
  return `${baseUrl}?${params.toString()}`;
}

function parsePostedAt(raw) {
  if (!raw) return null;
  try {
    return new Date(raw).toISOString();
  } catch {
    return null;
  }
}

export const advancetrsSource = {
  name: 'advancetrs',
  isConfigured() {
    return String(process.env.ADVANCETRS_ENABLED ?? 'true').toLowerCase() !== 'false';
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
        { source: 'advancetrs', searchId: search.id },
      );
      html = response.data ?? '';
    } catch (err) {
      logger.warn('Advance TRS fetch failed', { searchId: search.id, message: err.message });
      return [];
    }

    const jobs = [];
    const articles = html.split('<article').slice(1);

    for (const block of articles) {
      const titleLink = block.match(/<h3[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!titleLink) continue;

      const jobUrl = titleLink[1];
      const title = stripHtml(titleLink[2]);
      if (!title || !jobUrl.includes('/job/')) continue;

      const location = stripHtml(block.match(/class="[^"]*location[^"]*"[^>]*>([^<]+)/i)?.[1] ?? '');
      const salaryParts = [...block.matchAll(/class="[^"]*salary[^"]*"[^>]*>([^<]+)/gi)].map((m) => m[1].trim());
      const salaryText = salaryParts.join(' - ').replace(/\s*-\s*-\s*/, ' - ');
      const postedRaw = block.match(/<time[^>]*datetime="([^"]+)"/i)?.[1]
        ?? block.match(/<time[^>]*>([^<]+)/i)?.[1];
      const description = stripHtml(block.match(/<div class="job-content">[\s\S]*?<p>([\s\S]*?)<\/p>/i)?.[1] ?? '');
      const contractHint = block.match(/class="[^"]*job-type[^"]*"[^>]*>([^<]+)/i)?.[1] ?? '';

      if (!isRelevantJob(title, description)) {
        logger.debug('Advance TRS job filtered by relevance', { title, searchId: search.id });
        continue;
      }

      const salaryInfo = buildSalaryInfo({
        title,
        description: [description, salaryText].filter(Boolean).join(' | '),
      });

      const externalId = jobUrl.match(/\/job\/([^/]+)\/?$/)?.[1] ?? jobUrl;

      jobs.push({
        externalId,
        source: 'advancetrs',
        title,
        company: 'Advance TRS',
        location: location || search.location,
        salaryMin: salaryInfo.salaryMin,
        salaryMax: salaryInfo.salaryMax,
        salaryText: salaryInfo.salaryText || salaryText,
        isContract: salaryInfo.isContract || /contract/i.test(contractHint),
        url: jobUrl,
        postedAt: parsePostedAt(postedRaw),
        searchId: search.id,
        description: [description, postedRaw].filter(Boolean).join(' | '),
      });
    }

    logger.debug('Advance TRS jobs fetched', { searchId: search.id, count: jobs.length });
    return jobs;
  },
};
