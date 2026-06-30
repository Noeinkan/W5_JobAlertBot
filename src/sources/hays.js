import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appConfig } from '../config.js';
import { buildSalaryInfo } from '../utils/salary.js';
import { isRelevantJob } from '../utils/relevance.js';
import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

const curlArgs = [
  '--silent',
  '--compressed',
  '--location',
  '--max-time', String(Math.ceil(appConfig.requestTimeoutMs / 1000)),
  '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  '--header', 'Accept: text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
  '--header', 'Accept-Language: en-GB,en;q=0.9',
];

function pickKeyword(search) {
  const first = Array.isArray(search.keywords) ? search.keywords[0] : null;
  return (first && first.trim()) || search.query || '';
}

function buildSearchUrl(search) {
  const params = new URLSearchParams({
    q: pickKeyword(search),
    location: search.location,
    sortType: '0',
    jobType: '-1',
    flexiWorkType: '-1',
    payTypefacet: '-1',
    minPay: '-1',
    maxPay: '-1',
    jobSource: 'HaysGCJ',
  });
  return `https://www.hays.co.uk/job-search?${params.toString()}`;
}

function stripText(html) {
  return String(html ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function parsePostedAt(raw) {
  if (!raw) return null;
  const normalized = String(raw).trim();
  if (/posted today/i.test(normalized)) {
    return new Date().toISOString();
  }
  const dmy = normalized.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmy) {
    const [, day, month, year] = dmy;
    return new Date(`${year}-${month}-${day}T00:00:00Z`).toISOString();
  }
  try {
    return new Date(normalized).toISOString();
  } catch {
    return null;
  }
}

function slugify(...parts) {
  return parts
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function buildHaysJobUrl(html, jobId, jobReference, title, location) {
  if (jobId && html) {
    const escapedId = jobId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pageMatch = html.match(new RegExp(`href="(/job-detail/[^"]*applyId=${escapedId}[^"]*)"`));
    if (pageMatch) {
      return `https://www.hays.co.uk${pageMatch[1].replace(/&amp;/g, '&')}`;
    }
  }

  if (jobReference && jobId) {
    const slug = slugify(title, location);
    return `https://www.hays.co.uk/job-detail/${slug}_${jobReference}?applyId=${jobId}`;
  }

  return null;
}

function parseHaysJobs(html) {
  const jobs = [];
  const cardRe = /<lib-sb-job-card[\s\S]*?<h4[^>]*>\s*([^<]+?)\s*<\/h4>[\s\S]*?<\/lib-sb-job-card>\s*<div[^>]*id="analytics-field"[\s\S]*?id="JobId"[^>]*>([^<]+)[\s\S]*?id="JobReference"[^>]*>([^<]+)/g;

  for (const match of html.matchAll(cardRe)) {
    const title = stripText(match[1]);
    const jobId = stripText(match[2]);
    const jobReference = stripText(match[3]);
    if (!title) continue;

    const cardHtml = match[0];
    const locationMatch = cardHtml.match(/<\/svg>\s*([^<]+?)\s*<\/li>/);
    const salaryMatch = cardHtml.match(/<\/div>\s*([^<]+?)\s*<\/li>/);
    const dateMatch = cardHtml.match(/class="text-black fs-300"[^>]*>([^<]+)/);

    const location = stripText(locationMatch?.[1] ?? '');
    const salaryText = stripText(salaryMatch?.[1] ?? '');
    const url = buildHaysJobUrl(html, jobId, jobReference, title, location);

    jobs.push({
      externalId: jobId || `${title}-${location}`,
      title,
      location,
      salaryText,
      url,
      postedAt: parsePostedAt(dateMatch?.[1]),
      description: [title, location, salaryText].filter(Boolean).join(' | '),
    });
  }

  return jobs;
}

async function fetchHtml(url) {
  const { stdout } = await execFileAsync('curl', [...curlArgs, url], {
    maxBuffer: 15 * 1024 * 1024,
  });
  return stdout;
}

export const haysSource = {
  name: 'hays',
  isConfigured() {
    return true;
  },
  async fetchJobs(search) {
    const url = buildSearchUrl(search);
    let html;

    try {
      html = await fetchHtml(url);
    } catch (err) {
      logger.warn('Hays fetch failed', { searchId: search.id, message: err.message });
      return [];
    }

    const rawJobs = parseHaysJobs(html);
    const jobs = [];

    for (const raw of rawJobs) {
      const { title, description } = raw;

      if (!isRelevantJob(title, description)) {
        logger.debug('Hays job filtered by relevance', { title, searchId: search.id });
        continue;
      }

      const salaryInfo = buildSalaryInfo({ title, description });

      jobs.push({
        externalId: raw.externalId,
        source: 'hays',
        title,
        company: 'Hays',
        location: raw.location || search.location,
        salaryMin: salaryInfo.salaryMin,
        salaryMax: salaryInfo.salaryMax,
        salaryText: salaryInfo.salaryText || raw.salaryText,
        isContract: salaryInfo.isContract,
        url: raw.url || url,
        postedAt: raw.postedAt,
        searchId: search.id,
        description,
      });
    }

    logger.debug('Hays jobs fetched', { searchId: search.id, count: jobs.length });
    return jobs;
  },
};
