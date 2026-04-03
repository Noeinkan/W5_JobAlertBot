# New Job Source Integration Guide

This document explains how to add each missing job source to the bot. Sources are grouped by implementation effort. The four-step integration checklist at the end applies to every source.

---

## Summary Table

| Source | Method | Credentials | Difficulty | Priority |
|---|---|---|---|---|
| CIOB Jobs | RSS (no key) | None | Low | High |
| BIM+ Jobs | RSS (no key) | None | Low | High |
| Technojobs | RSS (no key) | None | Medium | Medium |
| Totaljobs | HTML scraping | None | Medium-High | High |
| CWJobs | HTML scraping | None | Medium-High | High |
| Hays UK | HTML scraping (`__NEXT_DATA__`) | None | High | Medium |
| Michael Page | HTML scraping (`__NEXT_DATA__`) | None | High | Medium |
| Monster UK | Partner API (OAuth 2.0) | Approval required | High | Low |
| Glassdoor | Partner API | Approval required | High | Low |
| Indeed UK | — (deferred) | — | — | Deferred |

---

## Recommended Implementation Order

**Phase 1 — Zero-credential RSS** (implement first)
1. CIOB Jobs
2. BIM+ Jobs
3. Technojobs

**Phase 2 — HTML scraping** (no credentials, moderate effort)
4. Totaljobs
5. CWJobs

**Phase 3 — Next.js JSON extraction** (higher fragility risk)
6. Hays UK
7. Michael Page

**Phase 4 — Partner APIs** (requires approval application, long lead time)
8. Monster UK
9. Glassdoor

---

## Phase 1 — Zero-credential RSS Sources

### CIOB Jobs

**Priority:** High — directly relevant to construction/BIM roles (Chartered Institute of Building).

| | |
|---|---|
| Method | RSS, no credentials |
| Feed URL | `https://jobs.ciob.org/jobs/feed/` |
| Response format | RSS/XML |
| Rate limits | None known — public feed |

The feed returns all current listings without keyword filtering. Filter client-side by checking each item's title and description against `search.keywords` after parsing (same pattern as `construction_enquirer.js`).

**Expected RSS fields**

| RSS field | Normalized field |
|---|---|
| `<title>` | `title` |
| `<link>` | `url`, `externalId` |
| `<guid>` | fallback `externalId` |
| `<pubDate>` | `postedAt` |
| `<description>` or `<content:encoded>` | `description` |
| `<dc:creator>` or employer field | `company` |

**Model on:** `src/sources/construction_enquirer.js`

---

### BIM+ Jobs

**Priority:** High — BIM/digital construction niche (published by CIOB Media).

| | |
|---|---|
| Method | RSS, no credentials |
| Feed URL | `https://www.bimplus.co.uk/jobs/feed/` |
| Fallback URL | `https://www.bimplus.co.uk/feed/?post_type=job_listing` |
| Response format | RSS/XML |
| Rate limits | None known — public feed |

WordPress job board. If the primary feed URL returns empty, try the WP Job Manager plugin pattern (`?post_type=job_listing`). May include `<job_listing:location>` custom namespace fields for location data.

Filter client-side by keywords, same as CIOB Jobs.

**Model on:** `src/sources/construction_enquirer.js`

---

### Technojobs

**Priority:** Medium — UK tech-focused board, lists BIM/digital construction technology roles.

| | |
|---|---|
| Method | Parameterised RSS, no credentials |
| Feed URL | `https://www.technojobs.co.uk/rss.phtml?job={keywords}&location={location}` |
| Response format | RSS/XML |
| Rate limits | None documented |

Accepts keywords and location as query parameters — server-side filtering, so the feed returns only matching results.

Example:
```
https://www.technojobs.co.uk/rss.phtml?job=BIM+Manager&location=London
```

Salary and company are usually embedded in the `<description>` field as HTML text. Strip HTML before passing to `buildSalaryInfo`.

**Model on:** `src/sources/jobserve.js` (parameterised RSS with HTML stripping)

---

## Phase 2 — HTML Scraping Sources

### Totaljobs

**Priority:** High — largest UK generalist board, high listing volume.

| | |
|---|---|
| Method | HTML scraping via curl |
| Base URL | `https://www.totaljobs.com/jobs/{keywords-slug}/in-{location-slug}` |
| Response format | HTML (`<article>` tags with `data-*` attributes) |
| Rate limits | Not documented; Cloudflare may block |

**URL pattern**

Keywords and location must be lower-cased and hyphenated:
```
https://www.totaljobs.com/jobs/bim-manager/in-london?salary=60000&radius=20&postedWithin=3
```

**Supported query parameters**

| Parameter | Purpose |
|---|---|
| `salary` | Minimum salary (integer) |
| `radius` | Radius in miles |
| `postedWithin` | Days since posted (e.g. `3`) |
| `contractType` | `permanent`, `contract`, `temp` |

**Parsing strategy**

Job data is embedded in `data-*` attributes on `<article>` elements:
- `data-job-id` → `externalId`
- `data-job-title` → `title`
- `data-company-name` → `company`
- `data-job-location` → `location`
- `data-job-salary` → `salaryText` (pass to `buildSalaryInfo`)

**Slug builder:**
```js
function toSlug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
```

**Model on:** `src/sources/cvlibrary.js` (curl + regex pattern)

---

### CWJobs

**Priority:** High — IT/tech focused UK board, strong BIM/digital construction volume.

| | |
|---|---|
| Method | HTML scraping via curl |
| Base URL | `https://www.cwjobs.co.uk/jobs/{keywords-slug}/in-{location-slug}` |
| Response format | HTML (identical DOM structure to Totaljobs) |
| Rate limits | Same as Totaljobs (StepStone group) |

CWJobs is on the same StepStone platform as Totaljobs — identical URL structure, identical `data-*` attributes on `<article>` tags. The adapter is a near-copy of `totaljobs.js` with only the base domain changed.

Example:
```
https://www.cwjobs.co.uk/jobs/bim-manager/in-london?salary=60000&radius=20&postedWithin=3
```

**Note on Jooble overlap:** Jooble already aggregates some CWJobs listings. Deduplication in `db.js` handles this — Jooble-wrapped URLs differ from direct CWJobs URLs, so both can notify. This is acceptable for coverage purposes.

**Model on:** `src/sources/totaljobs.js` (once built)

---

## Phase 3 — Next.js JSON Extraction

Both Hays and Michael Page are Next.js applications. Their search result pages embed a `__NEXT_DATA__` JSON payload in a `<script>` tag that contains server-side-rendered job data. This is more reliable than HTML parsing but more fragile than a formal API — the JSON structure can change with site deployments.

**General extraction pattern:**
```js
const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
if (!match) return [];
const data = JSON.parse(match[1]);
const jobs = data?.props?.pageProps?.jobs ?? [];
```

Wrap `JSON.parse` in try/catch and return `[]` on failure.

---

### Hays UK

**Priority:** Medium — major UK recruiter, strong in construction/digital engineering placement.

| | |
|---|---|
| Method | curl + `__NEXT_DATA__` JSON extraction |
| Search URL | `https://www.hays.co.uk/jobs/search?term={keywords}&location={location}&radius=20` |
| Response format | HTML with embedded JSON blob |

**Expected JSON fields** (path may vary — inspect `props.pageProps` structure):

| JSON field | Normalized field |
|---|---|
| `id` or `jobRef` | `externalId` |
| `title` | `title` |
| `employer` or `clientName` | `company` |
| `location.name` | `location` |
| `salary` | `salaryText` → `buildSalaryInfo` |
| `employmentType` | `isContract` hint |
| `publishedDate` | `postedAt` |
| `url` | `url` |

---

### Michael Page

**Priority:** Medium — senior/executive placement specialist, strong digital/construction coverage.

| | |
|---|---|
| Method | curl + `__NEXT_DATA__` JSON extraction (or frontend JSON API) |
| Search URL | `https://www.michaelpage.co.uk/jobs/construction?keywords={keywords}&location={location}` |
| Response format | HTML with embedded JSON blob |

**Alternative approach:** Michael Page's React frontend calls an internal JSON API. Inspect the browser network tab on the Michael Page search page to find the endpoint (typically something like `/api/jobs/search`). If a stable endpoint is found, use `axios.get` directly instead of curl — this is more reliable and avoids HTML parsing.

---

## Phase 4 — Partner APIs

Both Monster and Glassdoor require applying to a partner programme. Confirm the programme is still active and open before investing implementation time.

---

### Monster UK

| | |
|---|---|
| Method | OAuth 2.0 partner API |
| Token endpoint | `POST https://api.monster.com/auth/oauth2/token` |
| Search endpoint | `GET https://api.monster.com/ads/v1/ads?q={keywords}&where={location}&country=gb` |
| Auth type | Bearer token (OAuth 2.0 client credentials) |
| Env vars | `MONSTER_CLIENT_ID`, `MONSTER_CLIENT_SECRET` |

**How to obtain credentials:** Apply at `https://partner.monster.com/` or contact a Monster account manager.

**Token exchange:**
```js
const resp = await axios.post(
  'https://api.monster.com/auth/oauth2/token',
  new URLSearchParams({ grant_type: 'client_credentials', client_id, client_secret }),
  { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
);
const token = resp.data.access_token;
// cache until resp.data.expires_in
```

**Expected response fields:** `id`, `title`, `company.name`, `locations[0].city`, `salary.min`, `salary.max`, `datePublished`, `landingPageUrl`.

**`config.js` env vars to add:**
```js
monsterClientId: process.env.MONSTER_CLIENT_ID ?? '',
monsterClientSecret: process.env.MONSTER_CLIENT_SECRET ?? '',
```

**`getConfiguredSources()` entry:**
```js
monster: Boolean(env.monsterClientId && env.monsterClientSecret),
```

---

### Glassdoor

| | |
|---|---|
| Method | Partner API (key in query params) |
| Search endpoint | `GET https://api.glassdoor.com/api/api.htm?v=1&action=jobs&countryId=3&q={keywords}&l={location}&format=json` |
| Auth type | `partnerId` + `partnerKey` query parameters |
| Env vars | `GLASSDOOR_PARTNER_ID`, `GLASSDOOR_PARTNER_KEY` |

**How to obtain credentials:** Apply at `https://www.glassdoor.com/developer/index.htm`. Agree to Glassdoor API Terms of Use.

**Note:** Glassdoor's partner API has historically been difficult to access for non-enterprise partners. Verify the programme is still open before applying.

**Expected response path:** `response.jobListings`. Fields: `jobListingId`, `jobTitle`, `employerName`, `locationName`, `salary`, `listingDate`, `jobViewUrl`.

**`config.js` env vars to add:**
```js
glassdoorPartnerId: process.env.GLASSDOOR_PARTNER_ID ?? '',
glassdoorPartnerKey: process.env.GLASSDOOR_PARTNER_KEY ?? '',
```

**`getConfiguredSources()` entry:**
```js
glassdoor: Boolean(env.glassdoorPartnerId && env.glassdoorPartnerKey),
```

---

## Indeed UK — Deferred

Do not build a dedicated Indeed adapter. Reasons:

1. **Serper already covers Indeed.** The existing `serper.js` adapter queries Google Jobs, which aggregates Indeed listings. Indeed results appear with direct `indeed.co.uk` links.
2. **Publisher API is restricted.** Access requires a formal partner relationship and compliance with click attribution requirements — not suitable for personal alerting bots.
3. **HTML scraping is reliably blocked.** Indeed uses Cloudflare, CAPTCHA, and IP fingerprinting. Curl-based scraping will fail in production.

**Workaround for more targeted Indeed coverage:** Add `site:indeed.co.uk` to specific Serper searches via `source_options`:
```json
"source_options": {
  "serper": {
    "q_suffix": " site:indeed.co.uk"
  }
}
```
This requires a minor extension to `serper.js` to support a `q_suffix` option.

---

## Full Integration Checklist

The same four steps apply to every new source:

| Step | File | What to add |
|---|---|---|
| 1. Create adapter | `src/sources/{name}.js` | Export `{ name, isConfigured(), fetchJobs(search) }` |
| 2a. Add env var (keyed sources only) | `src/config.js` → `env` object | `sourceKey: process.env.SOURCE_ENV_VAR ?? ''` |
| 2b. Register source | `src/config.js` → `getConfiguredSources()` | `sourceName: true` or `Boolean(env.key)` |
| 2c. Add display label | `src/config.js` → `getSourceLabel()` | `'sourceName': 'Display Name'` |
| 3. Wire up | `src/index.js` | Import + add to `sourceClients[]` |
| 4. Enable by default | `data/searches.json` | Add `"sourceName"` to `defaults.allowed_sources` |

For no-credential sources (Phases 1–2), step 2a is skipped and `isConfigured()` returns `true`.

---

## Shared Implementation Notes

**Error handling:** Every `fetchJobs` call is wrapped in try/catch in `src/index.js`. Throw freely on fetch failure — the main loop skips the source and continues. Use `withRetry` from `src/utils/http.js` for transient HTTP errors.

**`fast-xml-parser` options** (reuse from `construction_enquirer.js`):
```js
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
```

**`externalId` uniqueness:** Use the most stable identifier available — a numeric job ID from the API or feed is best. For scraped sources without a stable ID, use the job URL stripped of query params. Do not use `title + company` as an ID.

**`postedAt` format:** Convert to ISO 8601 via `new Date(raw).toISOString()`. Wrap in try/catch and default to `null` on failure.

**Relevance filtering:** Always apply `isRelevantJob(job, search)` from `src/utils/relevance.js` before returning results.

**Salary parsing:** Always apply `buildSalaryInfo(salaryText)` from `src/utils/salary.js` to extract `salaryMin`, `salaryMax`, `isContract`.

## Dependencies

No new npm packages are required for Phases 1–3. Everything needed is already installed:

| Need | Available via |
|---|---|
| RSS/XML parsing | `fast-xml-parser` |
| HTTP with retry | `axios` + `withRetry` (`src/utils/http.js`) |
| curl-based scraping | `node:child_process` `execFileAsync` |
| JSON POST requests | `axios.post` |

Monster (Phase 4) also requires no new packages — OAuth token exchange uses `axios.post` with `URLSearchParams`.

## Canonical Reference Files

| Pattern | Reference file |
|---|---|
| No-key RSS (all listings, client-side filter) | `src/sources/construction_enquirer.js` |
| Parameterised RSS (server-side filter) | `src/sources/jobserve.js` |
| curl HTML scraping | `src/sources/cvlibrary.js` |
| POST JSON API | `src/sources/jooble.js` |
| REST API with key | `src/sources/guardian.js` |
| OAuth API | `src/sources/jooble.js` (POST pattern) + `src/utils/http.js` |
