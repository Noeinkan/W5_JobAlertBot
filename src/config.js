import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({
  path: path.resolve(process.cwd(), '.env'),
  override: true,
});

const dataDir = path.resolve(process.cwd(), 'data');
const searchesPath = path.join(dataDir, 'searches.json');

const defaultSearches = [
  {
    id: 'bim_lead',
    name: 'BIM leadership roles',
    enabled: true,
    keywords: ['BIM Lead', 'BIM Manager', 'Head of BIM'],
    location: 'London',
    min_salary: 70000,
    tags: ['bim_lead', 'permanent'],
    allowed_sources: ['adzuna', 'reed', 'serper'],
  },
  {
    id: 'digital_delivery',
    name: 'Digital delivery leadership',
    enabled: true,
    keywords: ['Digital Delivery Lead', 'Digital Delivery Manager'],
    location: 'London',
    min_salary: 80000,
    tags: ['digital_delivery', 'permanent'],
    allowed_sources: ['adzuna', 'reed', 'serper'],
  },
  {
    id: 'information_management',
    name: 'Information management',
    enabled: true,
    keywords: ['Information Manager ISO 19650', 'Information Management Lead'],
    location: 'London',
    min_salary: 60000,
    tags: ['information_management', 'permanent'],
    allowed_sources: ['adzuna', 'reed', 'serper'],
  },
  {
    id: 'head_digital_construction',
    name: 'Head of digital construction',
    enabled: true,
    keywords: ['Head of Digital construction', 'Director Digital construction', 'Digital Transformation Lead AEC'],
    location: 'London',
    min_salary: 90000,
    tags: ['head_digital_construction', 'permanent'],
    allowed_sources: ['adzuna', 'reed', 'serper'],
  },
  {
    id: 'cde_architect',
    name: 'CDE and solution architecture',
    enabled: true,
    keywords: ['CDE architect', 'Common Data Environment', 'CDE Solution'],
    location: 'London',
    min_salary: 70000,
    tags: ['cde_architect', 'permanent'],
    allowed_sources: ['adzuna', 'reed', 'serper'],
  },
  {
    id: 'contract_bim',
    name: 'Contract BIM roles',
    enabled: true,
    keywords: ['BIM Manager contract', 'Information Manager contract infrastructure'],
    location: 'London',
    min_salary: null,
    contract_only: true,
    tags: ['contract_bim', 'contract'],
    allowed_sources: ['adzuna', 'reed', 'serper'],
    exclude_keywords: ['graduate', 'junior', 'trainee'],
  },
];

const defaultSearchConfig = {
  defaults: {
    location: 'London',
    distance_from_location: 10,
    allowed_sources: ['adzuna', 'reed', 'serper'],
    exclude_keywords: [],
    tags: [],
  },
  searches: defaultSearches,
};

function arrayOrFallback(value, fallback = []) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : fallback;
}

function buildKeywords(search) {
  if (Array.isArray(search.keywords) && search.keywords.length > 0) {
    return search.keywords.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof search.keywords === 'string' && search.keywords.trim()) {
    return search.keywords
      .split(/\s+OR\s+/i)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof search.query === 'string' && search.query.trim()) {
    return search.query
      .split(/\s+OR\s+/i)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizeSearch(search, defaults) {
  const keywords = buildKeywords(search);
  const query = keywords.join(' OR ');
  const tags = [...defaults.tags, ...arrayOrFallback(search.tags)];
  const allowedSources = arrayOrFallback(search.allowed_sources, defaults.allowed_sources);
  const excludeKeywords = [...defaults.exclude_keywords, ...arrayOrFallback(search.exclude_keywords)];

  return {
    id: String(search.id),
    name: String(search.name ?? search.id),
    enabled: search.enabled !== false,
    keywords,
    query,
    location: String(search.location ?? defaults.location),
    min_salary: search.min_salary == null ? null : Number(search.min_salary),
    contract_only: Boolean(search.contract_only),
    distance_from_location: Number(search.distance_from_location ?? defaults.distance_from_location ?? 10),
    tags: Array.from(new Set(tags)),
    allowed_sources: allowedSources,
    exclude_keywords: Array.from(new Set(excludeKeywords)),
    source_options: search.source_options && typeof search.source_options === 'object' ? search.source_options : {},
    category: search.category ?? null,
    enrich_jobs: Boolean(search.enrich_jobs),
    require_keywords_in_page: arrayOrFallback(search.require_keywords_in_page),
  };
}

export const env = {
  discordToken: process.env.DISCORD_TOKEN ?? '',
  discordChannelId: process.env.DISCORD_CHANNEL_ID ?? '',
  discordGuildId: process.env.DISCORD_GUILD_ID ?? '',
  discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL ?? '',
  adzunaAppId: process.env.ADZUNA_APP_ID ?? '',
  adzunaAppKey: process.env.ADZUNA_APP_KEY ?? '',
  reedApiKey: process.env.REED_API_KEY ?? '',
  serperApiKey: process.env.SERPER_API_KEY ?? '',
  joobleApiKey: process.env.JOOBLE_API_KEY ?? '',
  guardianApiKey: process.env.GUARDIAN_API_KEY ?? '',
  serperCacheMinutes: Number.parseInt(process.env.SERPER_CACHE_MINUTES ?? '360', 10),
  apiDelayMs: Number.parseInt(process.env.API_DELAY_MS ?? '1000', 10),
  enrichDelayMs: Number.parseInt(process.env.ENRICH_DELAY_MS ?? '500', 10),
  httpMaxRetries: Number.parseInt(process.env.HTTP_MAX_RETRIES ?? '3', 10),
  httpRetryDelayMs: Number.parseInt(process.env.HTTP_RETRY_DELAY_MS ?? '1500', 10),
  logLevel: process.env.LOG_LEVEL ?? 'debug',
  startupRunOnBoot: String(process.env.STARTUP_RUN_ON_BOOT ?? 'false').toLowerCase() === 'true',
  runOnce: process.argv.includes('--once') || String(process.env.RUN_ONCE ?? 'false').toLowerCase() === 'true',
  profileFitEnabled: (() => {
    const v = process.env.PROFILE_FIT_ENABLED;
    if (v === undefined || v === '') return true;
    const s = String(v).toLowerCase();
    if (['false', '0', 'no', 'off'].includes(s)) return false;
    return true;
  })(),
  /** When true with profile fit on, Profile Amber is filtered like Red (only Profile Green notifies). */
  profileFitStrict: ['true', '1', 'yes', 'on'].includes(String(process.env.PROFILE_FIT_STRICT ?? '').toLowerCase()),
  profileFitPath: process.env.PROFILE_FIT_PATH
    ? path.resolve(process.cwd(), process.env.PROFILE_FIT_PATH)
    : path.join(dataDir, 'profile.json'),
  monsterClientId: process.env.MONSTER_CLIENT_ID ?? '',
  monsterClientSecret: process.env.MONSTER_CLIENT_SECRET ?? '',
  glassdoorPartnerId: process.env.GLASSDOOR_PARTNER_ID ?? '',
  glassdoorPartnerKey: process.env.GLASSDOOR_PARTNER_KEY ?? '',
};

function resolveSourceMaxResultsPerQuery() {
  const raw = process.env.SOURCE_MAX_RESULTS_PER_QUERY;
  const n = raw === undefined || raw === '' ? 300 : Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 1) return 300;
  return Math.min(n, 1000);
}

export const appConfig = {
  timezone: 'Europe/London',
  scheduleExpression: '0 1,7,13,19 * * *',
  scheduleHours: [1, 7, 13, 19],
  dataDir,
  dbPath: path.join(dataDir, 'jobs.db'),
  logsDir: path.resolve(process.cwd(), 'logs'),
  logFilePath: path.resolve(process.cwd(), 'logs', 'job-alert-bot.log'),
  searchesPath,
  requestTimeoutMs: 15000,
  /** Cap on raw listings fetched per source × saved search (pagination depth). Env: SOURCE_MAX_RESULTS_PER_QUERY */
  sourceMaxResultsPerQuery: resolveSourceMaxResultsPerQuery(),
};

export function ensureBaseConfig() {
  const missing = [];

  if (!hasDiscordWebhookConfig() && !hasDiscordBotConfig()) {
    missing.push('DISCORD_WEBHOOK_URL or DISCORD_TOKEN + DISCORD_CHANNEL_ID');
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

export function hasDiscordBotConfig() {
  return Boolean(env.discordToken && env.discordChannelId);
}

export function hasDiscordWebhookConfig() {
  return Boolean(env.discordWebhookUrl);
}

export function getConfiguredSources() {
  return {
    adzuna: Boolean(env.adzunaAppId && env.adzunaAppKey),
    reed: Boolean(env.reedApiKey),
    serper: Boolean(env.serperApiKey),
    linkedin: true,
    jooble: Boolean(env.joobleApiKey),
    careerjet: true,
    guardian: Boolean(env.guardianApiKey),
    jobserve: true,
    construction_enquirer: true,
    cvlibrary: true,
    risetechnical: true,
    ciob: true,
    bimplus: true,
    technojobs: true,
    totaljobs: true,
    cwjobs: true,
    hays: true,
    michaelpage: true,
    monster: Boolean(env.monsterClientId && env.monsterClientSecret),
    glassdoor: Boolean(env.glassdoorPartnerId && env.glassdoorPartnerKey),
  };
}

export function loadSearches() {
  try {
    if (!fs.existsSync(searchesPath)) {
      return defaultSearchConfig.searches.map((search) => normalizeSearch(search, defaultSearchConfig.defaults));
    }

    const raw = fs.readFileSync(searchesPath, 'utf8');
    const parsed = JSON.parse(raw);
    const defaults = {
      ...defaultSearchConfig.defaults,
      ...(parsed.defaults ?? {}),
      allowed_sources: arrayOrFallback(parsed.defaults?.allowed_sources, defaultSearchConfig.defaults.allowed_sources),
      exclude_keywords: arrayOrFallback(parsed.defaults?.exclude_keywords, defaultSearchConfig.defaults.exclude_keywords),
      tags: arrayOrFallback(parsed.defaults?.tags, defaultSearchConfig.defaults.tags),
    };

    if (!Array.isArray(parsed.searches) || parsed.searches.length === 0) {
      return defaultSearchConfig.searches.map((search) => normalizeSearch(search, defaults));
    }

    return parsed.searches
      .filter((search) => search?.id)
      .map((search) => normalizeSearch(search, defaults))
      .filter((search) => search.enabled && search.query && search.location);
  } catch {
    return defaultSearchConfig.searches.map((search) => normalizeSearch(search, defaultSearchConfig.defaults));
  }
}

export function getSourceLabel(source) {
  return {
    adzuna: 'Adzuna',
    reed: 'Reed',
    serper: 'Serper',
    linkedin: 'LinkedIn',
    jooble: 'Jooble',
    careerjet: 'Careerjet',
    guardian: 'Guardian Jobs',
    jobserve: 'JobServe',
    construction_enquirer: 'Construction Enquirer',
    cvlibrary: 'CV-Library',
    risetechnical: 'Rise Technical',
    ciob: 'CIOB Jobs',
    bimplus: 'BIM+ Jobs',
    technojobs: 'Technojobs',
    totaljobs: 'Totaljobs',
    cwjobs: 'CWJobs',
    hays: 'Hays',
    michaelpage: 'Michael Page',
    monster: 'Monster',
    glassdoor: 'Glassdoor',
  }[source] ?? source;
}
