import axios from 'axios';
import { appConfig } from '../config.js';
import { withRetry } from '../utils/http.js';
import { buildSalaryInfo } from '../utils/salary.js';
import { isRelevantJob } from '../utils/relevance.js';
import { logger } from '../utils/logger.js';

const baseUrl = 'https://www.icerecruit.com/jobs/';
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
    Within: String(search.distance_from_location ?? 20),
  });
  return `${baseUrl}?${params.toString()}`;
}

function absolutizeUrl(path) {
  if (!path) return null;
  const trimmed = path.replace(/\s+/g, '');
  if (trimmed.startsWith('http')) return trimmed;
  return `https://www.icerecruit.com${trimmed.startsWith('/') ? '' : '/'}${trimmed}`;
}

export const icerecruitSource = {
  name: 'icerecruit',
  isConfigured() {
    return String(process.env.ICERECRUIT_ENABLED ?? 'true').toLowerCase() !== 'false';
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
        { source: 'icerecruit', searchId: search.id },
      );
      html = response.data ?? '';
    } catch (err) {
      logger.warn('ICE Recruit fetch failed', { searchId: search.id, message: err.message });
      return [];
    }

    const jobs = [];
    const blocks = html.split(/class="lister__item/).slice(1);

    for (const block of blocks) {
      const titleLink = block.match(/<h3 class="lister__header"><a[\s\S]*?href="\s*([^"]+?)\s*"[\s\S]*?><span>([^<]+)<\/span>/);
      if (!titleLink) continue;

      const jobUrl = absolutizeUrl(titleLink[1]);
      const title = stripHtml(titleLink[2]);
      if (!title || !jobUrl) continue;

      const location = stripHtml(block.match(/lister__meta-item--location">([^<]+)/)?.[1] ?? '');
      const salaryText = stripHtml(block.match(/lister__meta-item--salary">([^<]+)/)?.[1] ?? '');
      const company = stripHtml(block.match(/lister__meta-item--recruiter">([^<]+)/)?.[1] ?? '');
      const description = [title, location, salaryText, company].filter(Boolean).join(' | ');

      if (!isRelevantJob(title, description)) {
        logger.debug('ICE Recruit job filtered by relevance', { title, searchId: search.id });
        continue;
      }

      const salaryInfo = buildSalaryInfo({ title, description });
      const externalId = jobUrl.match(/\/job\/(\d+)/)?.[1] ?? jobUrl;

      jobs.push({
        externalId,
        source: 'icerecruit',
        title,
        company: company || 'ICE Recruit',
        location: location || search.location,
        salaryMin: salaryInfo.salaryMin,
        salaryMax: salaryInfo.salaryMax,
        salaryText: salaryInfo.salaryText || salaryText,
        isContract: salaryInfo.isContract,
        url: jobUrl,
        postedAt: null,
        searchId: search.id,
        description,
      });
    }

    logger.debug('ICE Recruit jobs fetched', { searchId: search.id, count: jobs.length });
    return jobs;
  },
};
