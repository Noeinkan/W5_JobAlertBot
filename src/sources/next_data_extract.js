import { logger } from '../utils/logger.js';

function flattenJobBuckets(pageProps) {
  if (!pageProps || typeof pageProps !== 'object') return [];

  const buckets = [
    pageProps.jobs,
    pageProps.initialJobs,
    pageProps.jobResults,
    pageProps.searchResults?.jobs,
    pageProps.results?.jobs,
    pageProps.jobSearchResults?.jobs,
    pageProps.search?.jobs,
    Array.isArray(pageProps.searchResults) ? pageProps.searchResults : null,
    pageProps.data?.jobs,
    pageProps.redux?.jobs,
  ];

  const out = [];

  for (const bucket of buckets) {
    if (!bucket) continue;
    if (Array.isArray(bucket)) {
      for (const item of bucket) {
        if (item && typeof item === 'object') out.push(item);
      }
    }
  }

  return out;
}

export function extractJobsFromNextDataHtml(html, meta = {}) {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) {
    logger.debug('No __NEXT_DATA__ script in HTML', meta);
    return [];
  }

  try {
    const data = JSON.parse(match[1]);
    const pageProps = data?.props?.pageProps ?? {};
    return flattenJobBuckets(pageProps);
  } catch (err) {
    logger.warn('Failed to parse __NEXT_DATA__ JSON', { ...meta, message: err.message });
    return [];
  }
}

export function pickString(...vals) {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return '';
}

function leafText(cur) {
  if (cur == null) return '';
  if (typeof cur === 'string') return cur.trim();
  if (typeof cur === 'number' && Number.isFinite(cur)) return String(cur);
  return '';
}

export function pickNested(obj, paths) {
  if (!obj) return '';
  for (const path of paths) {
    const parts = path.split('.');
    let cur = obj;
    for (const p of parts) {
      cur = cur?.[p];
    }
    const s = leafText(cur);
    if (s) return s;
  }
  return '';
}
