import { appConfig } from '../config.js';
import { fetchRenderedHtml } from '../utils/browser.js';
import { buildSalaryInfo } from '../utils/salary.js';
import { isRelevantJob } from '../utils/relevance.js';
import { logger } from '../utils/logger.js';

function pickKeyword(search) {
  const first = Array.isArray(search.keywords) ? search.keywords[0] : null;
  return (first && first.trim()) || search.query || '';
}

function stripHtml(html) {
  return String(html ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildSearchUrl(search) {
  const params = new URLSearchParams({
    q: pickKeyword(search),
    location: search.location,
    distance: String(search.distance_from_location ?? 10),
  });
  return `https://www.matchtech.com/job-search/?${params.toString()}`;
}

function parsePostedAt(raw) {
  if (!raw) return null;
  try {
    return new Date(raw).toISOString();
  } catch {
    return null;
  }
}

function parseMatchtechJobs(html) {
  const jobs = [];
  const blocks = html.split(/<li class="job-data/).slice(1);

  for (const block of blocks) {
    const link = block.match(/<a href="(\/job\/[^"]+)"/);
    const title = block.match(/class="xs-heading"[^>]*>\s*<span>([^<]+)<\/span>/);
    if (!link || !title) continue;

    const jobUrl = `https://www.matchtech.com${link[1]}`;
    const titleText = stripHtml(title[1]);
    const postedText = stripHtml(block.match(/class="post-date"[^>]*>([^<]+)/)?.[1] ?? '');
    const jobRef = stripHtml(block.match(/class="job-ref"[^>]*>([^<]+)/)?.[1] ?? '');
    const salaryText = stripHtml(block.match(/class="icon money"[\s\S]*?<span>([^<]+)<\/span>/)?.[1] ?? '');
    const location = stripHtml(block.match(/class="icon location"[\s\S]*?<span>([^<]+)<\/span>/)?.[1] ?? '');
    const contractHint = stripHtml(block.match(/class="icon contract"[\s\S]*?<span>([^<]+)<\/span>/)?.[1] ?? '');

    jobs.push({
      externalId: jobRef || link[1],
      title: titleText,
      location,
      salaryText,
      url: jobUrl,
      postedAt: parsePostedAt(postedText),
      contractHint,
      description: [titleText, location, salaryText, contractHint].filter(Boolean).join(' | '),
    });
  }

  return jobs;
}

export const matchtechSource = {
  name: 'matchtech',
  isConfigured() {
    return String(process.env.MATCHTECH_ENABLED ?? 'true').toLowerCase() !== 'false';
  },
  async fetchJobs(search) {
    const url = buildSearchUrl(search);

    const html = await fetchRenderedHtml(url, {
      timeoutMs: Math.max(appConfig.requestTimeoutMs, 30000),
      waitForSelector: 'li.job-data a[href*="/job/"]',
    });

    if (!html) {
      logger.warn('Matchtech fetch returned no HTML', { searchId: search.id });
      return [];
    }

    const rawJobs = parseMatchtechJobs(html);
    const jobs = [];

    for (const raw of rawJobs) {
      const { title, description } = raw;
      if (!title) continue;

      if (!isRelevantJob(title, description)) {
        logger.debug('Matchtech job filtered by relevance', { title, searchId: search.id });
        continue;
      }

      const salaryInfo = buildSalaryInfo({ title, description });

      jobs.push({
        externalId: raw.externalId,
        source: 'matchtech',
        title,
        company: 'Matchtech',
        location: raw.location || search.location,
        salaryMin: salaryInfo.salaryMin,
        salaryMax: salaryInfo.salaryMax,
        salaryText: salaryInfo.salaryText || raw.salaryText,
        isContract: salaryInfo.isContract || /contract/i.test(raw.contractHint ?? ''),
        url: raw.url,
        postedAt: raw.postedAt,
        searchId: search.id,
        description,
      });
    }

    logger.debug('Matchtech jobs fetched', { searchId: search.id, count: jobs.length });
    return jobs;
  },
};
