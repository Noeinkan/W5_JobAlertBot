import axios from 'axios';
import { appConfig } from '../config.js';
import { logger } from './logger.js';

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fetches the job's detail page and returns the job with `description` replaced
 * by the full page text (stripped of HTML). Falls back to the original job on failure.
 *
 * For Adzuna we use the canonical detail URL since the redirect_url may land on
 * an external board with unpredictable HTML. Other sources use job.url directly.
 */
export async function enrichJobDescription(job) {
  const url =
    job.source === 'adzuna' && job.externalId
      ? `https://www.adzuna.co.uk/jobs/details/${job.externalId}`
      : job.url;

  if (!url) return job;

  try {
    const response = await axios.get(url, {
      timeout: appConfig.requestTimeoutMs,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      maxRedirects: 5,
    });

    if (typeof response.data === 'string') {
      const fullText = stripHtml(response.data);

      // Only upgrade if the page gave us more content
      if (fullText.length > (job.description?.length ?? 0)) {
        logger.debug('Page enrichment succeeded', {
          source: job.source,
          externalId: job.externalId,
          originalLength: job.description?.length ?? 0,
          enrichedLength: fullText.length,
        });
        return { ...job, description: fullText };
      }
    }
  } catch (error) {
    logger.debug('Page enrichment failed', { url, message: error.message });
  }

  return job;
}
