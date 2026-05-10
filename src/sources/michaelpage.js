import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appConfig } from '../config.js';
import { buildSalaryInfo } from '../utils/salary.js';
import { isRelevantJob } from '../utils/relevance.js';
import { logger } from '../utils/logger.js';
import {
  extractJobsFromNextDataHtml,
  pickNested,
  pickString,
} from './next_data_extract.js';

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

function buildSearchUrl(search) {
  const params = new URLSearchParams({
    keywords: search.query,
    location: search.location,
  });
  return `https://www.michaelpage.co.uk/jobs/construction?${params.toString()}`;
}

function normalizeJob(raw, search, fallbackListUrl) {
  const title = pickNested(raw, ['title', 'jobTitle', 'name']);
  const company = pickNested(raw, ['employerName', 'company.name', 'employer', 'clientName']);
  const location = pickNested(raw, ['location.name', 'location', 'town', 'city', 'jobLocation']);
  const salaryText = pickNested(raw, ['salary', 'salaryText', 'remuneration']);
  const url = pickNested(raw, ['url', 'jobUrl', 'link', 'seoUrl']);
  const postedRaw = pickNested(raw, ['postedDate', 'publishedDate', 'datePosted']);

  let postedAt = null;
  if (postedRaw) {
    try {
      postedAt = new Date(postedRaw).toISOString();
    } catch {
      // ignore
    }
  }

  const externalId = pickString(
    raw?.jobId,
    raw?.id,
    raw?.reference,
    url,
    `${title}-${company}`,
  );

  const descriptionParts = [
    pickNested(raw, ['description', 'summary']),
    salaryText,
  ].filter(Boolean);

  return {
    externalId,
    title,
    company,
    location: location || search.location,
    salaryText,
    url: url?.startsWith('http') ? url : url ? `https://www.michaelpage.co.uk${url.startsWith('/') ? '' : '/'}${url}` : fallbackListUrl,
    postedAt,
    description: descriptionParts.join('\n'),
    rawContractHint: pickNested(raw, ['employmentType', 'contractType']),
  };
}

async function fetchHtml(url) {
  const { stdout } = await execFileAsync('curl', [...curlArgs, url], {
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

export const michaelpageSource = {
  name: 'michaelpage',
  isConfigured() {
    return true;
  },
  async fetchJobs(search) {
    const url = buildSearchUrl(search);
    let html;

    try {
      html = await fetchHtml(url);
    } catch (err) {
      logger.warn('Michael Page fetch failed', { searchId: search.id, message: err.message });
      return [];
    }

    const rawJobs = extractJobsFromNextDataHtml(html, { source: 'michaelpage', searchId: search.id });
    const jobs = [];

    for (const raw of rawJobs) {
      const normalized = normalizeJob(raw, search, url);
      const { title, description } = normalized;

      if (!title) continue;

      if (!isRelevantJob(title, description)) {
        logger.debug('Michael Page job filtered by relevance', { title, searchId: search.id });
        continue;
      }

      const salaryInfo = buildSalaryInfo({
        title,
        description,
      });

      const isContractType = /contract/i.test(normalized.rawContractHint ?? '');

      jobs.push({
        externalId: normalized.externalId,
        source: 'michaelpage',
        title,
        company: normalized.company || 'Unknown company',
        location: normalized.location,
        salaryMin: salaryInfo.salaryMin,
        salaryMax: salaryInfo.salaryMax,
        salaryText: salaryInfo.salaryText,
        isContract: salaryInfo.isContract || isContractType,
        url: normalized.url,
        postedAt: normalized.postedAt,
        searchId: search.id,
        description,
      });
    }

    logger.debug('Michael Page jobs fetched', { searchId: search.id, count: jobs.length });
    return jobs;
  },
};
