import cron from 'node-cron';
import {
  appConfig,
  ensureBaseConfig,
  env,
  getConfiguredSources,
  hasDiscordBotConfig,
  hasDiscordWebhookConfig,
  loadSearches,
} from './config.js';
import { getJobsToday, getPendingJobs, getStats, insertJob, logRun, markJobNotified } from './db.js';
import {
  buildHealthEmbed,
  buildStatsEmbed,
  createDiscordClient,
  getAlertChannel,
  registerSlashCommands,
  sendDailySummary,
  sendDailySummaryWebhook,
  sendJobAlert,
  sendJobAlertsWebhook,
  sendNoNewJobsMessage,
  sendNoNewJobsMessageWebhook,
  sendStartupMessage,
  sendStartupMessageWebhook,
} from './discord.js';
import { adzunaSource } from './sources/adzuna.js';
import { advancetrsSource } from './sources/advancetrs.js';
import { bimplusSource } from './sources/bimplus.js';
import { careerjetSource } from './sources/careerjet.js';
import { ciobSource } from './sources/ciob.js';
import { constructionEnquirerSource } from './sources/construction_enquirer.js';
import { cwjobsSource } from './sources/cwjobs.js';
import { cvlibrarySource } from './sources/cvlibrary.js';
import { glassdoorSource } from './sources/glassdoor.js';
import { guardianSource } from './sources/guardian.js';
import { haysSource } from './sources/hays.js';
import { icerecruitSource } from './sources/icerecruit.js';
import { joobleSource } from './sources/jooble.js';
import { jobserveSource } from './sources/jobserve.js';
import { linkedinSource } from './sources/linkedin.js';
import { matchtechSource } from './sources/matchtech.js';
import { michaelpageSource } from './sources/michaelpage.js';
import { monsterSource } from './sources/monster.js';
import { morsonSource } from './sources/morson.js';
import { reedSource } from './sources/reed.js';
import { risetechnicalSource } from './sources/risetechnical.js';
import { serperSource } from './sources/serper.js';
import { technojobsSource } from './sources/technojobs.js';
import { totaljobsSource } from './sources/totaljobs.js';
import { logger } from './utils/logger.js';
import { jobMatchesSearch, sourceAllowed } from './utils/search.js';
import { passesMinimumSalary } from './utils/salary.js';
import { scoreJob } from './utils/rag.js';
import { isSeniorEnough } from './utils/seniority.js';
import { enrichJobDescription } from './utils/enrich.js';
import { extractJobSignals, mergeJobSignals } from './utils/extractors.js';
import { analyzeJobWithLLM } from './utils/llm.js';
import { createRunCsvLog } from './utils/run_log_csv.js';
import { loadProfileFitConfig, scoreProfileFit } from './utils/profileFit.js';

const client = hasDiscordBotConfig() ? createDiscordClient() : null;
const disabledSources = new Set(
  String(process.env.DISABLED_SOURCES ?? '')
    .split(/[\s,]+/)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
);
function isSourceEnabled(s) {
  if (s?.isConfigured && !s.isConfigured()) return false;
  if (s?.name && disabledSources.has(s.name)) return false;
  return true;
}
if (disabledSources.size > 0) {
  logger.info('Disabled sources via env', { names: [...disabledSources].sort() });
}
const sourceClients = [
  adzunaSource,
  advancetrsSource,
  bimplusSource,
  careerjetSource,
  ciobSource,
  constructionEnquirerSource,
  cwjobsSource,
  cvlibrarySource,
  glassdoorSource,
  guardianSource,
  haysSource,
  icerecruitSource,
  joobleSource,
  jobserveSource,
  linkedinSource,
  matchtechSource,
  michaelpageSource,
  monsterSource,
  morsonSource,
  reedSource,
  risetechnicalSource,
  serperSource,
  technojobsSource,
  totaljobsSource,
].filter(isSourceEnabled);

let isRunInProgress = false;
let startupMessageSent = false;
let lastRunSummary = null;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getNextRunText() {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: appConfig.timezone,
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: 'short',
    hourCycle: 'h23',
  });

  const parts = formatter.formatToParts(new Date());
  const currentHour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const currentMinute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  const currentDay = parts.find((part) => part.type === 'day')?.value ?? '';
  const currentMonth = parts.find((part) => part.type === 'month')?.value ?? '';

  const nextHour = appConfig.scheduleHours.find((hour) => hour > currentHour || (hour === currentHour && currentMinute === 0));

  if (nextHour != null && !(nextHour === currentHour && currentMinute === 0)) {
    return `today, ${String(nextHour).padStart(2, '0')}:00 Europe/Rome`;
  }

  if (nextHour != null) {
    const following = appConfig.scheduleHours.find((hour) => hour > currentHour);

    if (following != null) {
      return `today, ${String(following).padStart(2, '0')}:00 Europe/Rome`;
    }
  }

  return `tomorrow after ${currentDay} ${currentMonth}, ${String(appConfig.scheduleHours[0]).padStart(2, '0')}:00 Europe/Rome`;
}

function getEnabledSourceNames() {
  const configured = getConfiguredSources();

  return Object.entries(configured)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);
}

function formatDuration(seconds) {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  return [hours, minutes, remainingSeconds]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
}

function getHealthSnapshot() {
  return {
    isRunInProgress,
    uptime: formatDuration(process.uptime()),
    nextRunText: getNextRunText(),
    enabledSources: getEnabledSourceNames(),
    lastRunSummary,
  };
}

async function runSearchCycle(trigger = 'scheduled') {
  if (isRunInProgress) {
    return {
      skipped: true,
      reason: 'A run is already in progress.',
      newJobs: 0,
      totalResults: 0,
    };
  }

  isRunInProgress = true;
  const searches = loadSearches();
  const newJobs = [];
  let totalResults = 0;
  let failedSources = 0;
  const cycleStats = {
    rawFetched: 0,
    filteredNotRelevant: 0,
    filteredSeniority: 0,
    filteredRag: 0,
    filteredProfile: 0,
    filteredProfileStrict: 0,
    alreadySeen: 0,
  };
  const csvLog = createRunCsvLog(trigger);
  const warnedUnconfigured = new Set();

  let profileFitConfigPath = null;
  if (env.profileFitEnabled) {
    try {
      loadProfileFitConfig(env.profileFitPath);
      profileFitConfigPath = env.profileFitPath;
      logger.info('Profile fit enabled', { path: env.profileFitPath });
    } catch (err) {
      logger.warn('Profile fit disabled: could not load profile config', {
        path: env.profileFitPath,
        message: err.message,
      });
    }
  }

  logger.info('Starting search cycle', {
    trigger,
    searches: searches.length,
  });

  try {
    for (const search of searches) {
      for (const sourceClient of sourceClients) {
        if (!sourceAllowed(search, sourceClient.name)) {
          continue;
        }

        if (!sourceClient.isConfigured()) {
          if (!warnedUnconfigured.has(sourceClient.name)) {
            logger.warn('Skipping source because credentials are missing', { source: sourceClient.name });
            warnedUnconfigured.add(sourceClient.name);
          }
          continue;
        }

        await delay(Math.max(0, env.apiDelayMs));

        logger.info(`Fetching [${sourceClient.name}] "${search.keywords}"`);

        try {
          const rawJobs = await sourceClient.fetchJobs(search);

          logger.info(`  → ${rawJobs.length} raw results from ${sourceClient.name}`);

          cycleStats.rawFetched += rawJobs.length;

          const csvBase = {
            trigger,
            search_id: search.id,
            search_name: search.name,
            source: sourceClient.name,
            country: search.country,
          };

          // Score every candidate; annotate with filter_reason instead of dropping.
          // jobMatchesSearch stays as a hard filter — mismatches shouldn't be attributed to this search.
          const scoredJobs = [];
          for (const rawJob of rawJobs) {
            const base = {
              ...csvBase,
              title: rawJob.title,
              company: rawJob.company,
              location: rawJob.location,
              salary_text: rawJob.salaryText,
              salary_min: rawJob.salaryMin,
              salary_max: rawJob.salaryMax,
              is_contract: rawJob.isContract ? 'yes' : 'no',
              url: rawJob.url,
              posted_at: rawJob.postedAt,
            };

            if (!jobMatchesSearch(rawJob, search)) {
              cycleStats.filteredNotRelevant += 1;
              csvLog.append({ ...base, desc_chars: rawJob.description?.length ?? 0, enriched: 'no', outcome: 'filtered_match' });
              continue;
            }

            let job = rawJob;
            let enriched = false;
            if (search.enrich_jobs) {
              await delay(env.enrichDelayMs);
              const enrichedJob = await enrichJobDescription(rawJob);
              enriched = (enrichedJob.description?.length ?? 0) > (rawJob.description?.length ?? 0);
              job = enrichedJob;
            }

            const signals = extractJobSignals({
              title: job.title,
              description: job.description,
              salaryTextHint: job.salaryText,
              country: search.country,
            });
            job = mergeJobSignals(job, signals);

            const salaryPassed = passesMinimumSalary(job, search.min_salary);
            const seniority = isSeniorEnough(job);
            const { rating, score, reason, matches } = scoreJob(job);

            // LLM analysis runs on Amber+Green when enabled; on success its verdict
            // overrides the regex rating for downstream filters and notifications.
            const llmResult = (env.ollamaEnabled && rating !== 'Red')
              ? await analyzeJobWithLLM(job, { regexRating: rating, regexScore: score })
              : null;
            const effective = llmResult?.ok
              ? { rating: llmResult.rating, score: llmResult.score, reason: llmResult.reason }
              : { rating, score, reason };

            let profileRating = null;
            let profileScore = null;
            let profileReason = null;
            let profileMatches = null;
            if (profileFitConfigPath) {
              const pf = scoreProfileFit(job, profileFitConfigPath);
              profileRating = pf.rating;
              profileScore = pf.score;
              profileReason = pf.reason;
              profileMatches = pf.matches;
            }

            let filterReason = null;
            if (!salaryPassed) {
              filterReason = 'filtered_salary';
              cycleStats.filteredNotRelevant += 1;
            } else if (!seniority.passes) {
              filterReason = 'filtered_seniority';
              cycleStats.filteredSeniority += 1;
            } else if (effective.rating === 'Red') {
              filterReason = 'filtered_rag';
              cycleStats.filteredRag += 1;
            } else if (profileFitConfigPath && profileRating === 'Red') {
              filterReason = 'filtered_profile';
              cycleStats.filteredProfile += 1;
            } else if (
              profileFitConfigPath &&
              env.profileFitStrict &&
              profileRating === 'Amber'
            ) {
              filterReason = 'filtered_profile_strict';
              cycleStats.filteredProfileStrict += 1;
            }

            scoredJobs.push({
              job: {
                ...job,
                country: search.country,
                tags: job.tags ?? search.tags,
                ragRating: effective.rating,
                ragScore: effective.score,
                ragReason: effective.reason,
                ragMatches: matches,
                regexRating: rating,
                regexScore: score,
                regexReason: reason,
                llmRating: llmResult?.ok ? llmResult.rating : null,
                llmScore: llmResult?.ok ? llmResult.score : null,
                llmReason: llmResult?.ok ? llmResult.reason : null,
                llmFitSummary: llmResult?.ok ? llmResult.fitSummary : null,
                llmModel: llmResult?.ok ? llmResult.model : null,
                llmAnalyzedAt: llmResult?.ok ? llmResult.analyzedAt : null,
                llmLatencyMs: llmResult ? llmResult.latencyMs : null,
                profileRating,
                profileScore,
                profileReason,
                profileMatches,
                seniorityPassed: seniority.passes,
                salaryPassed,
                filterReason,
              },
              csvRow: {
                ...base,
                salary_text: job.salaryText,
                salary_min: job.salaryMin,
                salary_max: job.salaryMax,
                is_contract: job.isContract ? 'yes' : 'no',
                desc_chars: job.description?.length ?? 0,
                enriched: enriched ? 'yes' : 'no',
                rag_rating: effective.rating,
                rag_score: effective.score,
                rag_reason: effective.reason,
                regex_rating: rating,
                regex_score: score,
                regex_reason: reason,
                llm_rating: llmResult?.ok ? llmResult.rating : '',
                llm_score: llmResult?.ok ? llmResult.score : '',
                llm_latency_ms: llmResult ? llmResult.latencyMs : '',
                profile_rating: profileRating ?? '',
                profile_score: profileScore ?? '',
                profile_reason: profileReason ?? '',
                remote_type: job.remoteType ?? '',
                contract_length_months: job.contractLengthMonths ?? '',
                sectors: (job.sectors ?? []).join('|'),
                clearances: (job.clearances ?? []).join('|'),
                tech_tools: (job.techTools ?? []).join('|'),
                years_experience: job.yearsExperience ?? '',
                has_bonus: job.hasBonus ? 'yes' : '',
                bonus_percent: job.bonusPercent ?? '',
                car_allowance: job.carAllowance ?? '',
                pension_percent: job.pensionPercent ?? '',
                has_equity: job.hasEquity ? 'yes' : '',
              },
              filterReason,
            });
          }

          const eligibleJobs = scoredJobs.filter((entry) => entry.filterReason == null);
          totalResults += eligibleJobs.length;
          let newJobsForRunLog = 0;

          for (const { job, csvRow, filterReason } of scoredJobs) {
            const inserted = insertJob(job);
            let outcome;

            if (filterReason) {
              outcome = filterReason;
            } else if (inserted) {
              outcome = 'new';
              newJobs.push(job);
              newJobsForRunLog += 1;
            } else {
              outcome = 'already_seen';
              cycleStats.alreadySeen += 1;
            }

            csvLog.append({ ...csvRow, outcome });
          }

          logger.info(`  → ${eligibleJobs.length} passed filters, ${newJobsForRunLog} new`);

          logRun({
            source: sourceClient.name,
            searchId: search.id,
            resultsFound: eligibleJobs.length,
            newJobs: newJobsForRunLog,
          });
        } catch (error) {
          failedSources += 1;
          logger.error('Source fetch failed', {
            source: sourceClient.name,
            searchId: search.id,
            message: error.message,
          });

          logRun({
            source: sourceClient.name,
            searchId: search.id,
            resultsFound: 0,
            newJobs: 0,
          });
        }
      }
    }

    const pendingJobs = getPendingJobs();

    if (pendingJobs.length > 0) {
      if (hasDiscordWebhookConfig()) {
        await sendJobAlertsWebhook(env.discordWebhookUrl, pendingJobs);
        for (const job of pendingJobs) {
          markJobNotified(job);
        }
      } else if (client) {
        const channel = await getAlertChannel(client);

        for (const job of pendingJobs) {
          await sendJobAlert(channel, job);
          markJobNotified(job);
        }
      }
    } else {
      if (hasDiscordWebhookConfig()) {
        await sendNoNewJobsMessageWebhook(env.discordWebhookUrl);
      } else if (client) {
        const channel = await getAlertChannel(client);
        await sendNoNewJobsMessage(channel);
      }
    }

    logger.info('Search cycle complete', {
      trigger,
      totalResultsFetched: cycleStats.rawFetched,
      filteredNotRelevant: cycleStats.filteredNotRelevant,
      filteredSeniority: cycleStats.filteredSeniority,
      filteredRag: cycleStats.filteredRag,
      filteredProfile: cycleStats.filteredProfile,
      filteredProfileStrict: cycleStats.filteredProfileStrict,
      newJobsMatchingCriteria: newJobs.length,
      alreadySeen: cycleStats.alreadySeen,
      sentToDiscord: pendingJobs.length,
      failedSources,
    });

    lastRunSummary = {
      trigger,
      totalResults,
      newJobs: newJobs.length,
      failedSources,
      finishedAt: new Date().toISOString(),
      sentToDiscord: pendingJobs.length,
      notifiedAt: pendingJobs.length ? new Date().toISOString() : lastRunSummary?.notifiedAt || null,
    };

    return {
      skipped: false,
      newJobs: newJobs.length,
      totalResults,
      failedSources,
    };
  } finally {
    isRunInProgress = false;
  }
}

async function runDailySummary() {
  const stats = getStats();
  const jobsToday = getJobsToday();
  const summaryData = {
    jobsToday,
    totalJobs: stats.totalJobs,
    enabledSources: getEnabledSourceNames(),
    nextRunText: getNextRunText(),
  };

  if (hasDiscordWebhookConfig()) {
    await sendDailySummaryWebhook(env.discordWebhookUrl, summaryData);
  } else if (client) {
    const channel = await getAlertChannel(client);
    await sendDailySummary(channel, summaryData);
  }

  logger.info('Daily summary sent', { jobsToday: jobsToday.length });
}

async function handleReady() {
  if (!client) {
    return;
  }

  logger.info('Discord client ready', {
    user: client.user?.tag,
  });

  const mode = await registerSlashCommands(client.application.id);
  logger.info('Slash commands registered', { mode });

  cron.schedule(
    appConfig.scheduleExpression,
    async () => {
      await runSearchCycle('scheduled');
    },
    {
      timezone: appConfig.timezone,
    }
  );

  cron.schedule(
    '0 20 * * *',
    async () => {
      try {
        await runDailySummary();
      } catch (error) {
        logger.error('Daily summary failed', { message: error.message });
      }
    },
    {
      timezone: appConfig.timezone,
    }
  );

  if (!startupMessageSent) {
    if (hasDiscordWebhookConfig()) {
      await sendStartupMessageWebhook(env.discordWebhookUrl, getNextRunText(), getEnabledSourceNames(), lastRunSummary);
    } else {
      const channel = await getAlertChannel(client);
      await sendStartupMessage(channel, getNextRunText(), getEnabledSourceNames(), lastRunSummary);
    }
    startupMessageSent = true;
  }

  if (env.startupRunOnBoot) {
    await runSearchCycle('startup');
  }
}

if (client) {
  client.once('ready', async () => {
    try {
      await handleReady();
    } catch (error) {
      logger.error('Startup failed', { message: error.message });
    }
  });

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    if (interaction.commandName === 'search') {
      await interaction.deferReply({ ephemeral: true });
      const result = await runSearchCycle('manual');

      if (result.skipped) {
        await interaction.editReply(result.reason);
        return;
      }

      await interaction.editReply(`Search completed. ${result.newJobs} new jobs found from ${result.totalResults} matching results.`);
      return;
    }

    if (interaction.commandName === 'stats') {
      const stats = getStats();

      await interaction.reply({
        embeds: [buildStatsEmbed(stats)],
        ephemeral: true,
      });
      return;
    }

    if (interaction.commandName === 'ping') {
      const heartbeat = typeof client.ws.ping === 'number' ? `${client.ws.ping}ms` : 'unavailable';

      await interaction.reply({
        content: `Pong. Gateway heartbeat ${heartbeat}. Uptime ${formatDuration(process.uptime())}.`,
        ephemeral: true,
      });
      return;
    }

    if (interaction.commandName === 'health') {
      await interaction.reply({
        embeds: [buildHealthEmbed(getHealthSnapshot())],
        ephemeral: true,
      });
    }
  });

  client.on('error', (error) => {
    logger.error('Discord client error', { message: error.message });
  });
}

process.on('unhandledRejection', (error) => {
  logger.error('Unhandled promise rejection', {
    message: error instanceof Error ? error.message : String(error),
  });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { message: error.message });
});

ensureBaseConfig();

if (env.runOnce) {
  logger.info('Running one-shot search mode');
  const result = await runSearchCycle('oneshot');
  logger.info('One-shot search finished', result);
  if (client) {
    client.destroy();
  }
} else if (client) {
  await client.login(env.discordToken);
} else {
  logger.warn('Webhook delivery is configured without bot mode. Use npm run once or set RUN_ONCE=true to send alerts.');
}