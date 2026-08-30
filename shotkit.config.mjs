/**
 * shotkit config for the Job Alert Bot dashboard.
 *   node C:/Personal_utilities/screenshot-kit/shotkit.mjs --serve
 *
 * Notes learned the hard way (keep these):
 *  - The dashboard auto-opens a browser on boot; DASHBOARD_OPEN=0 stops that.
 *  - Everything renders from the local SQLite DB (data/jobs.db). No external
 *    hosts are needed — chart.js is vendored and served from /vendor.
 *  - #main (KPIs + overview charts) only exists after /api/data/all resolves;
 *    gate on '#kpiTotal' plus a canvas, and give charts ~2.5s to stop animating.
 *  - The table is virtualised: a row you want to click must be brought into the
 *    rendered window first — filter with #globalSearch instead of scrolling.
 *  - "Advanced analytics" and the pipeline diagram live in a collapsed
 *    <section data-section="advanced">; clicking .section-header toggles .open.
 *  - The 🩺 Diagnose button uses a native alert() — not screenshottable, and it
 *    blocks Playwright. Don't add a shot for it.
 */

/**
 * The table defaults to "Hide jobs > 2 months old" (60 days, persisted in
 * localStorage). This DB snapshot's newest posting is from June, so with the
 * box ticked the table collapses to ~15 of 553 rows. Untick it for any shot
 * that shows rows. Also clears leftover filters — the runner reuses one page
 * (and therefore one localStorage) for every shot in a run.
 */
async function showAllRows(page) {
  await page.waitForSelector('#dashHideOldJobs');
  if (await page.isChecked('#dashHideOldJobs')) await page.uncheck('#dashHideOldJobs');
  await page.click('#clearFilters');
  await page.waitForSelector('#tBody tr');
  await page.waitForTimeout(400);
}

/**
 * The OVERVIEW / ANALYTICS / PIPELINE / GLOSSARY checkboxes above the table
 * show or hide whole blocks, and the choice is persisted. Set them explicitly
 * per shot rather than assuming the default.
 */
async function setBlock(page, id, on) {
  await page.waitForSelector('#' + id);
  if ((await page.isChecked('#' + id)) !== on) await page.setChecked('#' + id, on);
  await page.waitForTimeout(400);
}

/** Sections persist their open/closed state, so toggle only when needed. */
async function openSection(page, name) {
  const section = page.locator(`section[data-section="${name}"]`);
  const isOpen = await section.evaluate(el => el.classList.contains('open'));
  if (!isOpen) await section.locator('.section-header').click();
  await page.waitForTimeout(400);
}

export default {
  baseUrl: 'http://localhost:3099',

  server: {
    command: 'node src/dashboard.js --port 3099',
    env: { DASHBOARD_OPEN: '0' },
    readyUrl: 'http://localhost:3099/',
    timeoutMs: 60000,
  },

  outDir: '.shots',
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
  settleMs: 1800,

  // Job listings are public postings; nothing personal is on screen.
  mask: [],

  shots: [
    {
      name: '01-overview',
      path: '/',
      waitFor: '#kpiTotal',
      settleMs: 2600,
      async prepare(page) {
        await page.waitForSelector('#cOutcome');
        await page.evaluate(() => {
          document.getElementById('main').scrollIntoView({ block: 'start' });
        });
      },
      shows: 'KPI row (total / notified / filtered / applied) over the overview charts — outcome, contract mix, RAG split, profile fit, sources',
      alt: 'Job Alert Bot dashboard overview: counters for total, notified and filtered jobs above doughnut and bar charts breaking the pipeline down by outcome, contract type, RAG rating and source',
    },
    {
      name: '02-job-table',
      path: '/',
      waitFor: '#tBody tr',
      async prepare(page) {
        await showAllRows(page);
        await page.evaluate(() => window.scrollTo(0, 0));
      },
      shows: '553 deduplicated jobs with per-column filters, RAG rating, score, the reason each score was given and the CV profile-fit second score',
      alt: 'Dense job table with columns for link, title, published date, outcome, profile fit score, RAG rating, score and reason, each row a scraped job posting',
    },
    {
      name: '03-job-preview',
      path: '/',
      waitFor: '#tBody tr',
      settleMs: 1500,
      async prepare(page) {
        await showAllRows(page);
        // Virtualised table: filter down to one job so its row is rendered.
        // The preview button is the "highlights" button in the Link column.
        await page.fill('#globalSearch', 'BIM Manager');
        await page.waitForTimeout(700);
        await page.locator('#tBody .job-preview-btn').first().click();
        await page.waitForSelector('#jobPreviewBody .job-preview-analysis, #jobPreviewBody .job-preview-prose');
        await page.waitForSelector('.job-preview-loading', { state: 'detached' });
      },
      shows: 'Job preview modal: the stored description plus the scoring breakdown — RAG rating and reason, profile-fit score, matched search and the signals that fired',
      alt: 'Modal dialog over the dashboard showing a BIM Manager job description alongside its RAG rating, score reason and profile-fit explanation',
    },
    {
      name: '04-chart-explorer',
      path: '/',
      waitFor: '#cSource',
      settleMs: 2600,
      async prepare(page) {
        await page.evaluate(() => {
          document.getElementById('main').scrollIntoView({ block: 'start' });
        });
        await page.locator('[data-fs-chart="cSource"]').first().click();
        await page.waitForSelector('#chartFsModal.open canvas');
      },
      shows: 'Fullscreen chart explorer — any overview chart reopens large with its own filter widgets (top-N, sort, value ranges) and an explanation of the metric',
      alt: 'Fullscreen chart modal showing jobs per source as a bar chart with a filter sidebar of chips, sliders and sort controls',
    },
    {
      name: '05-advanced-analytics',
      path: '/',
      waitFor: '#kpiTotal',
      settleMs: 3000,
      async prepare(page) {
        await setBlock(page, 'dashDiagAdvanced', true);
        await openSection(page, 'advanced');
        await page.waitForSelector('#dashAdvancedCharts canvas');
        await page.evaluate(() => {
          document.querySelector('section[data-section="advanced"]').scrollIntoView({ block: 'start' });
        });
      },
      shows: 'Advanced analytics: the second tier of charts built from the same run data — salary, seniority and per-search yield',
      alt: 'Expanded advanced analytics section with a grid of charts derived from job run logs',
    },
    {
      name: '06-pipeline-diagram',
      path: '/',
      waitFor: '#kpiTotal',
      settleMs: 1500,
      async prepare(page) {
        // Hide the analytics grid so the explainer lands at the top of the
        // frame instead of under a cropped scatter chart.
        await setBlock(page, 'dashDiagAdvanced', false);
        await openSection(page, 'advanced');
        await page.waitForSelector('#dashPipelineDiagram');
        await page.evaluate(() => {
          document.getElementById('dashPipelineDiagram').scrollIntoView({ block: 'start' });
        });
      },
      shows: 'Built-in explainer: how a job moves from the 25 sources through relevance, RAG scoring and the seniority/salary gates to a Discord alert',
      alt: 'Diagram card explaining the fetch pipeline stages from source adapters through scoring and filtering to notification',
    },
    {
      name: '07-cross-filter',
      path: '/',
      waitFor: '#tBody tr',
      settleMs: 1500,
      async prepare(page) {
        await showAllRows(page);
        // Column filters live in thead tr.filter-row; each control is
        // data-filter="<column key>" (keys come from app-core.js COLUMNS).
        await page.selectOption('tr.filter-row select[data-filter="rag_rating"]', 'Green');
        await page.waitForTimeout(700);
        await page.evaluate(() => window.scrollTo(0, 0));
      },
      shows: 'Cross-filtering: narrowing the table to Green-rated jobs, with the row counter and active-filter state updating',
      alt: 'Job table filtered to only Green RAG rated rows, showing the reduced row count',
    },
  ],
};
