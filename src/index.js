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
import { careerjetSource } from './sources/careerjet.js';
import { constructionEnquirerSource } from './sources/construction_enquirer.js';
import { cvlibrarySource } from './sources/cvlibrary.js';
import { guardianSource } from './sources/guardian.js';
import { joobleSource } from './sources/jooble.js';
import { jobserveSource } from './sources/jobserve.js';
import { linkedinSource } from './sources/linkedin.js';
import { reedSource } from './sources/reed.js';
import { serperSource } from './sources/serper.js';
import { logger } from './utils/logger.js';
import { jobMatchesSearch, sourceAllowed } from './utils/search.js';
import { passesMinimumSalary } from './utils/salary.js';
import { scoreJob } from './utils/rag.js';
import { isSeniorEnough } from './utils/seniority.js';

const client = hasDiscordBotConfig() ? createDiscordClient() : null;
const sourceClients = [
  adzunaSource,
  reedSource,
  serperSource,
  linkedinSource,
  joobleSource,
  careerjetSource,
  guardianSource,
  jobserveSource,
  constructionEnquirerSource,
  cvlibrarySource,
];

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
    return `today, ${String(nextHour).padStart(2, '0')}:00 Europe/London`;
  }

  if (nextHour != null) {
    const following = appConfig.scheduleHours.find((hour) => hour > currentHour);

    if (following != null) {
      return `today, ${String(following).padStart(2, '0')}:00 Europe/London`;
    }
  }

  return `tomorrow after ${currentDay} ${currentMonth}, ${String(appConfig.scheduleHours[0]).padStart(2, '0')}:00 Europe/London`;
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
    filteredRed: 0,
    alreadySeen: 0,
  };

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
          logger.warn('Skipping source because credentials are missing', {
            source: sourceClient.name,
            searchId: search.id,
          });
          continue;
        }

        await delay(Math.max(0, env.apiDelayMs));

        logger.info(`Fetching [${sourceClient.name}] "${search.keywords}"`);

        try {
          const rawJobs = await sourceClient.fetchJobs(search);

          logger.info(`  → ${rawJobs.length} raw results from ${sourceClient.name}`);

          const relevantJobs = rawJobs
            .filter((job) => jobMatchesSearch(job, search))
            .filter((job) => passesMinimumSalary(job, search.min_salary));

          cycleStats.rawFetched += rawJobs.length;
          cycleStats.filteredNotRelevant += rawJobs.length - relevantJobs.length;

          const seniorJobs = [];

          for (const job of relevantJobs) {
            const seniority = isSeniorEnough(job);
            if (!seniority.passes) {
              cycleStats.filteredRed += 1;
              continue;
            }

            const { rating, score, reason } = scoreJob(job);

            if (rating === 'Red') {
              cycleStats.filteredRed += 1;
              continue;
            }

            seniorJobs.push({
              ...job,
              tags: job.tags ?? search.tags,
              ragRating: rating,
              ragScore: score,
              ragReason: reason,
            });
          }

          totalResults += seniorJobs.length;
          let newJobsForRunLog = 0;

          for (const job of seniorJobs) {
            const inserted = insertJob(job);

            if (inserted) {
              newJobs.push(job);
              newJobsForRunLog += 1;
            } else {
              cycleStats.alreadySeen += 1;
            }
          }

          logger.info(`  → ${seniorJobs.length} passed filters, ${newJobsForRunLog} new`);

          logRun({
            source: sourceClient.name,
            searchId: search.id,
            resultsFound: seniorJobs.length,
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
      filteredRed: cycleStats.filteredRed,
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
      await sendStartupMessageWebhook(env.discordWebhookUrl, getNextRunText(), getEnabledSourceNames());
    } else {
      const channel = await getAlertChannel(client);
      await sendStartupMessage(channel, getNextRunText(), getEnabledSourceNames());
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