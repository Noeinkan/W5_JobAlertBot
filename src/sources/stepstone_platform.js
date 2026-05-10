import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appConfig } from '../config.js';
import { buildSalaryInfo } from '../utils/salary.js';
import { isRelevantJob } from '../utils/relevance.js';
import { logger } from '../utils/logger.js';
import { maxRawListingsPerQuery } from '../utils/sourcePagination.js';

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

export function toSlug(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function buildSearchUrl(search, origin, pageNum = 1) {
  const keywordRaw = search.keywords?.[0] ?? search.query.split(/\s+OR\s+/i)[0] ?? search.query;
  const keywordSlug = toSlug(keywordRaw);
  const locationSlug = toSlug(search.location);
  const path = `/jobs/${keywordSlug}/in-${locationSlug}`;
  const params = new URLSearchParams();

  if (search.min_salary != null && Number.isFinite(search.min_salary)) {
    params.set('salary', String(Math.round(search.min_salary)));
  }
  if (search.distance_from_location != null) {
    params.set('radius', String(search.distance_from_location));
  }
  params.set('postedWithin', '7');
  if (pageNum > 1) {
    params.set('page', String(pageNum));
  }

  const qs = params.toString();
  return `${origin}${path}${qs ? `?${qs}` : ''}`;
}

function attr(tag, name) {
  const match = tag.match(new RegExp(`${name}="([^"]*)"`, 'i'));
  return match ? match[1].replace(/&amp;/g, '&').trim() : '';
}

async function fetchHtml(url) {
  const { stdout } = await execFileAsync('curl', [...curlArgs, url], {
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Prefer an absolute /job/… link near the card (StepStone embeds links after the opening <article> tag). */
function findJobListingUrl(html, articleIndex, origin) {
  const slice = html.slice(articleIndex, articleIndex + 12000);
  const prefix = escapeRegExp(origin);
  const match = slice.match(new RegExp(`href="(${prefix}/job[^"?#]+)`, 'i'));
  return match ? match[1].replace(/&amp;/g, '&') : null;
}

export function createStepstoneSource({ name, origin }) {
  return {
    name,
    isConfigured() {
      return true;
    },
    async fetchJobs(search) {
      const maxScan = maxRawListingsPerQuery();
      const jobs = [];
      const seenIds = new Set();
      let cardsSeen = 0;

      outer: for (let pageNum = 1; pageNum <= 40; pageNum++) {
        const url = buildSearchUrl(search, origin, pageNum);
        let html;

        try {
          html = await fetchHtml(url);
        } catch (err) {
          if (pageNum === 1) {
            logger.warn(`${name} fetch failed`, { searchId: search.id, message: err.message });
          }
          break;
        }

        let offset = 0;
        let cardsThisPage = 0;

        while (true) {
          const open = html.indexOf('<article', offset);
          if (open === -1) break;

          const close = html.indexOf('>', open);
          if (close === -1) break;

          const raw = html.slice(open, close + 1);
          offset = close + 1;

          if (!/data-job-id=/i.test(raw)) continue;

          cardsThisPage += 1;
          cardsSeen += 1;

          const id = attr(raw, 'data-job-id');
          if (!id || seenIds.has(id)) {
            if (cardsSeen >= maxScan) break outer;
            continue;
          }

          const title = attr(raw, 'data-job-title');
          const company = attr(raw, 'data-company-name') || 'Unknown company';
          const location = attr(raw, 'data-job-location') || search.location;
          const salaryText = attr(raw, 'data-job-salary');

          if (!title) {
            if (cardsSeen >= maxScan) break outer;
            continue;
          }

          if (!isRelevantJob(title, salaryText)) {
            logger.debug(`${name} job filtered by relevance`, { title, searchId: search.id });
            if (cardsSeen >= maxScan) break outer;
            continue;
          }

          seenIds.add(id);

          const salaryInfo = buildSalaryInfo({
            title,
            description: salaryText,
          });

          const listingUrl = findJobListingUrl(html, open, origin);

          jobs.push({
            externalId: id,
            source: name,
            title,
            company,
            location,
            salaryMin: salaryInfo.salaryMin,
            salaryMax: salaryInfo.salaryMax,
            salaryText: salaryInfo.salaryText,
            isContract: salaryInfo.isContract,
            url: listingUrl ?? `${origin}/jobs/${toSlug(search.keywords?.[0] ?? search.query)}/in-${toSlug(search.location)}`,
            postedAt: null,
            searchId: search.id,
            description: salaryText || '',
          });

          if (cardsSeen >= maxScan) break outer;
        }

        if (cardsThisPage === 0) break;
      }

      logger.debug(`${name} jobs fetched`, { searchId: search.id, count: jobs.length });
      return jobs;
    },
  };
}
