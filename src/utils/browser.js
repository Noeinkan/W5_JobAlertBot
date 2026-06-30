import { appConfig, env } from '../config.js';
import { logger } from './logger.js';

const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

let chromiumModule = null;

async function getChromium() {
  if (!chromiumModule) {
    const mod = await import('playwright');
    chromiumModule = mod.chromium;
  }
  return chromiumModule;
}

/**
 * Fetch fully rendered HTML from a JS-heavy page using headless Chromium.
 * Returns empty string when browser fetch is disabled or fails.
 */
export async function fetchRenderedHtml(url, options = {}) {
  if (!env.browserFetchEnabled) {
    logger.debug('Browser fetch disabled', { url });
    return '';
  }

  const timeoutMs = options.timeoutMs ?? appConfig.requestTimeoutMs;
  const waitUntil = options.waitUntil ?? 'networkidle';
  const waitForSelector = options.waitForSelector ?? null;

  let browser;
  try {
    const chromium = await getChromium();
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage({
      userAgent,
      locale: 'en-GB',
    });

    await page.goto(url, {
      waitUntil,
      timeout: timeoutMs,
    });

    if (waitForSelector) {
      await page.waitForSelector(waitForSelector, { timeout: timeoutMs }).catch(() => {});
    }

    const html = await page.content();
    return html;
  } catch (err) {
    logger.warn('Browser fetch failed', { url, message: err.message });
    return '';
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
