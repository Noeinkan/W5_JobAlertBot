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
    term: search.query,
    location: search.location,
    radius: String(search.distance_from_location ?? 20),
  });
  return `https://www.hays.co.uk/jobs/search?${params.toString()}`;
}

function normalizeJob(raw, search) {
  const title = pickNested(raw, ['title', 'jobTitle', 'name']);
  const company = pickNested(raw, ['employer', 'clientName', 'company.name', 'companyName']);
  const location = pickNested(raw, ['location.name', 'location', 'town', 'city']);
  const salaryText = pickNested(raw, ['salary', 'salaryText', 'payRate']);
  const url = pickNested(raw, ['url', 'jobUrl', 'link', 'applyUrl']);
  const postedRaw = pickNested(raw, ['publishedDate', 'datePosted', 'postedDate', 'createdDate']);

  let postedAt = null;
  if (postedRaw) {
    try {
      postedAt = new Date(postedRaw).toISOString();
    } catch {
      // ignore
    }
  }

  const externalId = pickString(
    raw?.id,
    raw?.jobRef,
    raw?.reference,
    raw?.jobId,
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
    url,
    postedAt,
    description: descriptionParts.join('\n'),
    searchId: search.id,
    rawContractHint: pickNested(raw, ['employmentType', 'type']),
  };
}

async function fetchHtml(url) {
  const { stdout } = await execFileAsync('curl', [...curlArgs, url], {
    maxBuffer: 10 * 1024 * 1024,
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

    const rawJobs = extractJobsFromNextDataHtml(html, { source: 'hays', searchId: search.id });
    const jobs = [];

    for (const raw of rawJobs) {
      const normalized = normalizeJob(raw, search);
      const { title, description } = normalized;

      if (!title) continue;

      if (!isRelevantJob(title, description)) {
        logger.debug('Hays job filtered by relevance', { title, searchId: search.id });
        continue;
      }

      const salaryInfo = buildSalaryInfo({
        title,
        description,
      });

      const isContractType = /contract|temporary|temp/i.test(normalized.rawContractHint ?? '');

      jobs.push({
        externalId: normalized.externalId,
        source: 'hays',
        title,
        company: normalized.company || 'Unknown company',
        location: normalized.location,
        salaryMin: salaryInfo.salaryMin,
        salaryMax: salaryInfo.salaryMax,
        salaryText: salaryInfo.salaryText,
        isContract: salaryInfo.isContract || isContractType,
        url: normalized.url || url,
        postedAt: normalized.postedAt,
        searchId: search.id,
        description,
      });
    }

    logger.debug('Hays jobs fetched', { searchId: search.id, count: jobs.length });
    return jobs;
  },
};
