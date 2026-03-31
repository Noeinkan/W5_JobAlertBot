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
  '--header', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  '--header', 'Accept-Language: en-GB,en;q=0.9',
];

function buildSearchUrl(search) {
  const params = new URLSearchParams({ q: search.query, geo: search.location });
  if (search.distance_from_location) params.set('distance', String(search.distance_from_location));
  if (search.min_salary) params.set('salary_min', String(search.min_salary));
  params.set('tempperm', 'Any');
  return `https://www.cv-library.co.uk/search-jobs?${params.toString()}`;
}

function attr(tag, name) {
  const match = tag.match(new RegExp(`${name}="([^"]*)"`, 'i'));
  return match ? match[1].replace(/&amp;/g, '&').trim() : '';
}

function buildJobUrl(id, title) {
  const slug = title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  return `https://www.cv-library.co.uk/job/${id}/${slug}`;
}

async function fetchHtml(url) {
  const { stdout } = await execFileAsync('curl', [...curlArgs, url], {
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

export const cvlibrarySource = {
  name: 'cvlibrary',
  isConfigured() {
    return true;
  },
  async fetchJobs(search) {
    const url = buildSearchUrl(search);
    let html;

    try {
      html = await fetchHtml(url);
    } catch (err) {
      logger.warn('CV-Library fetch failed', { searchId: search.id, message: err.message });
      return [];
    }

    const articleRe = /<article[^>]*data-job-result[^>]*>/gi;
    const jobs = [];

    for (const tag of html.matchAll(articleRe)) {
      const raw = tag[0];
      const id = attr(raw, 'data-job-id');
      if (!id) continue;

      const title = attr(raw, 'data-job-title');
      const company = attr(raw, 'data-company-name') || 'Unknown company';
      const location = attr(raw, 'data-job-location') || search.location;
      const salaryText = attr(raw, 'data-job-salary');
      const jobType = attr(raw, 'data-job-type');
      const postedRaw = attr(raw, 'data-job-posted');

      if (!title) continue;

      if (!isRelevantJob(title, salaryText)) {
        logger.debug('CV-Library job filtered by relevance', { title, searchId: search.id });
        continue;
      }

      const isContractType = /contract/i.test(jobType);
      const salaryInfo = buildSalaryInfo({
        title,
        description: [salaryText, jobType].filter(Boolean).join(' '),
      });

      let postedAt = null;
      if (postedRaw) {
        try { postedAt = new Date(postedRaw).toISOString(); } catch { /* ignore */ }
      }

      jobs.push({
        externalId: id,
        source: 'cvlibrary',
        title,
        company,
        location,
        salaryMin: salaryInfo.salaryMin,
        salaryMax: salaryInfo.salaryMax,
        salaryText: salaryInfo.salaryText,
        isContract: salaryInfo.isContract || isContractType,
        url: buildJobUrl(id, title),
        postedAt,
        searchId: search.id,
        description: salaryText,
      });
    }

    logger.debug('CV-Library jobs fetched', { searchId: search.id, count: jobs.length });
    return jobs;
  },
};
