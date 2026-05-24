import axios from 'axios';
import { appConfig } from '../config.js';
import { withRetry } from '../utils/http.js';
import { getCountryConfig, textMentionsCountry } from '../utils/countries.js';
import { buildSalaryInfo } from '../utils/salary.js';
import { logger } from '../utils/logger.js';
import { isRelevantJob } from '../utils/relevance.js';
import { maxRawListingsPerQuery } from '../utils/sourcePagination.js';

const baseUrl = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';

function extractText(html, className) {
  const re = new RegExp(`class="[^"]*${className}[^"]*"[^>]*>([\\s\\S]*?)</`, 'i');
  const match = html.match(re);
  if (!match) return null;
  return match[1].replace(/<[^>]+>/g, '').trim() || null;
}

function extractHref(html, className) {
  // Try class-before-href and href-before-class variants
  const re1 = new RegExp(`class="[^"]*${className}[^"]*"[^>]*href="([^"]+)"`, 'i');
  const re2 = new RegExp(`href="([^"]+)"[^>]*class="[^"]*${className}[^"]*"`, 'i');
  return (html.match(re1) ?? html.match(re2))?.[1] ?? null;
}

function extractDatetime(html) {
  return html.match(/<time[^>]*datetime="([^"]+)"/i)?.[1] ?? null;
}

function extractCards(html) {
  return html.split('<li').slice(1).filter((chunk) => chunk.includes('base-card'));
}

const PAGE_SIZE = 25;

/** Avoid "United Kingdom, United Kingdom"; guest search expects a single geo string. */
function linkedInGeo(search) {
  const override = search.source_options?.linkedin?.location;
  if (override) return override;

  const countryConfig = getCountryConfig(search.country);
  const countryLabel = countryConfig.linkedinLabel;

  const loc = String(search.location ?? '').trim();
  if (!loc) return countryLabel;

  if (textMentionsCountry(loc, search.country)) {
    return loc;
  }

  return `${loc}, ${countryLabel}`;
}

export const linkedinSource = {
  name: 'linkedin',
  isConfigured() {
    return true;
  },
  async fetchJobs(search) {
    const countryConfig = getCountryConfig(search.country);
    const geo = linkedInGeo(search);

    const maxCards = maxRawListingsPerQuery();
    const allCards = [];
    for (let start = 0; start < maxCards; start += PAGE_SIZE) {
      const params = new URLSearchParams({
        keywords: search.query,
        location: geo,
        start: String(start),
        count: String(PAGE_SIZE),
      });

      const response = await withRetry(
        () => axios.get(`${baseUrl}?${params.toString()}`, {
          timeout: appConfig.requestTimeoutMs,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': countryConfig.linkedinAcceptLanguage,
          },
          responseType: 'text',
        }),
        { source: 'linkedin', searchId: search.id }
      );

      const page = extractCards(response.data);
      if (page.length === 0) break;
      allCards.push(...page);
      if (allCards.length >= maxCards) break;
    }

    const seenUrls = new Set();
    const jobs = [];

    for (const card of allCards.slice(0, maxCards)) {
      const title = extractText(card, 'base-search-card__title');
      if (!title) continue;

      const snippet = extractText(card, 'job-search-card__snippet') ?? '';
      if (!isRelevantJob(title, snippet)) continue;

      const company = extractText(card, 'base-search-card__subtitle') ?? 'Unknown company';
  const location = extractText(card, 'job-search-card__location') ?? search.location ?? countryConfig.linkedinLabel;
      const rawUrl = extractHref(card, 'base-card__full-link') ?? extractHref(card, 'base-card');
      const url = rawUrl ? rawUrl.split('?')[0] : null;
      if (url && seenUrls.has(url)) continue;
      if (url) seenUrls.add(url);
      const datetime = extractDatetime(card);

      const salaryInfo = buildSalaryInfo({ title, description: snippet, country: search.country });

      jobs.push({
        externalId: url ?? `${title}-${company}`,
        source: 'linkedin',
        title,
        company,
        location,
        salaryMin: salaryInfo.salaryMin,
        salaryMax: salaryInfo.salaryMax,
        salaryText: salaryInfo.salaryText,
        isContract: salaryInfo.isContract,
        url,
        postedAt: datetime ? new Date(datetime).toISOString() : null,
        searchId: search.id,
        description: snippet,
      });
    }

    logger.debug('LinkedIn jobs fetched', { searchId: search.id, count: jobs.length });
    return jobs;
  },
};
