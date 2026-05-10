import axios from 'axios';
import {
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from 'discord.js';
import { env, getSourceLabel } from './config.js';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunk(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function getRetryAfterMs(error) {
  const retryAfterSeconds = Number(error?.response?.headers?.['retry-after']);

  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return retryAfterSeconds * 1000;
  }

  const retryAfterMs = Number(error?.response?.data?.retry_after);

  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    return retryAfterMs;
  }

  return 1500;
}

async function postWebhookPayload(webhookUrl, payload) {
  let attempt = 0;

  while (attempt < 5) {
    try {
      await axios.post(webhookUrl, payload);
      return;
    } catch (error) {
      if (error?.response?.status !== 429) {
        throw error;
      }

      attempt += 1;
      await delay(getRetryAfterMs(error));
    }
  }

  throw new Error('Discord webhook rate limit retry budget exhausted.');
}

const commandDefinitions = [
  new SlashCommandBuilder()
    .setName('search')
    .setDescription('Trigger an immediate job search run'),
  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Show job statistics for the bot'),
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check whether the bot is responsive'),
  new SlashCommandBuilder()
    .setName('health')
    .setDescription('Show runtime health and source configuration'),
].map((command) => command.toJSON());

export function createDiscordClient() {
  return new Client({
    intents: [GatewayIntentBits.Guilds],
  });
}

export async function registerSlashCommands(applicationId) {
  const rest = new REST({ version: '10' }).setToken(env.discordToken);

  if (env.discordGuildId) {
    await rest.put(Routes.applicationGuildCommands(applicationId, env.discordGuildId), {
      body: commandDefinitions,
    });
    return 'guild';
  }

  await rest.put(Routes.applicationCommands(applicationId), {
    body: commandDefinitions,
  });
  return 'global';
}

export async function getAlertChannel(client) {
  const channel = await client.channels.fetch(env.discordChannelId);

  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new Error('Configured Discord channel is not a text channel.');
  }

  return channel;
}

function getPostedText(postedAt) {
  if (!postedAt) {
    return 'Posted date unavailable';
  }

  const date = new Date(postedAt);

  if (Number.isNaN(date.getTime())) {
    return postedAt;
  }

  return `<t:${Math.floor(date.getTime() / 1000)}:R>`;
}

const RAG_COLOR = { Green: 0x2ecc71, Amber: 0xf39c12, Red: 0xe74c3c };
const RAG_ICON = { Green: '🟢', Amber: '🟡', Red: '🔴' };

export function buildJobEmbed(job) {
  const useProfile =
    env.profileFitEnabled && job.profileRating != null && String(job.profileRating).length > 0;
  const displayRating = useProfile ? job.profileRating : (job.ragRating ?? 'Amber');
  const color = RAG_COLOR[displayRating] ?? 0xf39c12;
  const icon = RAG_ICON[displayRating] ?? '🟡';
  const contractLabel = job.isContract ? ' · CONTRACT' : '';
  const banner = `${displayRating.toUpperCase()} MATCH${contractLabel}`;
  const tags = job.tags?.length > 0
    ? job.tags.map((tag) => `#${tag}`).join(' ')
    : `#${job.searchId} ${job.isContract ? '#contract' : '#permanent'}`;

  const applyLine = job.url ? `[Apply Here](${job.url})` : 'Apply link unavailable';
  const ragIcon = RAG_ICON[job.ragRating] ?? '🟡';
  const ragRatingLabel = job.ragRating ?? 'Amber';
  const profileScoreLine =
    useProfile && job.profileScore != null
      ? `${icon} Profile: ${job.profileRating} (score: ${job.profileScore})${job.profileReason ? ` — ${job.profileReason}` : ''}`
      : null;
  const lexiconScoreLine =
    job.ragScore != null
      ? (useProfile
        ? `${ragIcon} Lexicon RAG: ${ragRatingLabel} (score: ${job.ragScore})${job.ragReason ? ` — ${job.ragReason}` : ''}`
        : `${ragIcon} ${ragRatingLabel} (score: ${job.ragScore})${job.ragReason ? ` — ${job.ragReason}` : ''}`)
      : null;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${icon} ${banner}`)
    .setDescription([
      `**${job.title}**`,
      `🏢 ${job.company || 'Unknown company'}`,
      `📍 ${job.location || 'Location not listed'}`,
      `💰 ${job.salaryText || 'Salary not listed'}`,
      `📅 Posted: ${getPostedText(job.postedAt)}`,
      `🔗 Source: ${getSourceLabel(job.source)}`,
      profileScoreLine,
      lexiconScoreLine,
      applyLine,
      `Tags: ${tags}`,
    ].filter(Boolean).join('\n'));

  if (job.url) {
    embed.setURL(job.url);
  }

  return embed;
}

export async function sendJobAlert(channel, job) {
  await channel.send({
    embeds: [buildJobEmbed(job)],
  });
}

export async function sendJobAlertWebhook(webhookUrl, job) {
  await postWebhookPayload(webhookUrl, {
    embeds: [buildJobEmbed(job).toJSON()],
    allowed_mentions: { parse: [] },
  });
}

export async function sendJobAlertsWebhook(webhookUrl, jobs) {
  const embeds = jobs.map((job) => buildJobEmbed(job).toJSON());
  const batches = chunk(embeds, 10);

  for (const batch of batches) {
    await postWebhookPayload(webhookUrl, {
      embeds: batch,
      allowed_mentions: { parse: [] },
    });
    await delay(500);
  }
}

export async function sendStartupMessage(channel, nextRunText, enabledSources) {
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('Job Alert Bot Online')
    .setDescription([
      'The bot is connected and ready.',
      `Next scheduled run: **${nextRunText}**`,
      `Enabled sources: ${enabledSources.join(', ') || 'none'}`,
    ].join('\n'));

  await channel.send({ embeds: [embed] });
}

export async function sendStartupMessageWebhook(webhookUrl, nextRunText, enabledSources) {
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('Job Alert Bot Online')
    .setDescription([
      'The bot is connected and ready.',
      `Next scheduled run: **${nextRunText}**`,
      `Enabled sources: ${enabledSources.join(', ') || 'none'}`,
    ].join('\n'));

  await postWebhookPayload(webhookUrl, {
    embeds: [embed.toJSON()],
    allowed_mentions: { parse: [] },
  });
}

export function buildStatsEmbed(stats) {
  const sourceLines = stats.bySource.length > 0
    ? stats.bySource.map((row) => `• ${getSourceLabel(row.source)}: ${row.count}`).join('\n')
    : 'No data yet';
  const searchLines = stats.bySearch.length > 0
    ? stats.bySearch.map((row) => `• ${row.search_id}: ${row.count}`).join('\n')
    : 'No data yet';

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Job Alert Stats')
    .addFields(
      {
        name: 'Totals',
        value: `Total jobs: ${stats.totalJobs}\nJobs found today: ${stats.jobsToday}`,
      },
      {
        name: 'By Source',
        value: sourceLines,
      },
      {
        name: 'By Search Query',
        value: searchLines,
      }
    );
}

export function buildDailySummaryMessage({ jobsToday, totalJobs, enabledSources, nextRunText }) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/London',
  });
  const dateStr = formatter.format(new Date());

  if (jobsToday.length === 0) {
    return {
      content: [
        `📊 **Daily Summary — ${dateStr}**`,
        'No new relevant jobs found today. Keep grinding 💪',
        `Next scan: ${nextRunText}`,
      ].join('\n'),
    };
  }

  const sourceStatus = enabledSources.map((s) => `${getSourceLabel(s)} ✅`).join(' ');
  const jobLines = jobsToday.map((job, index) => {
    const prefix = index === jobsToday.length - 1 ? '└──' : '├──';
    return `${prefix} ${job.title} at ${job.company} (${getSourceLabel(job.source)})`;
  });

  return {
    content: [
      `📊 **Daily Job Search Summary — ${dateStr}**`,
      `Jobs found today: ${jobsToday.length}`,
      ...jobLines,
      `Total jobs tracked: ${totalJobs}`,
      `Sources checked: ${sourceStatus}`,
      `Next scan: ${nextRunText}`,
    ].join('\n'),
  };
}

export async function sendNoNewJobsMessage(channel) {
  await channel.send({ content: 'No new jobs found this run.' });
}

export async function sendNoNewJobsMessageWebhook(webhookUrl) {
  await postWebhookPayload(webhookUrl, {
    content: 'No new jobs found this run.',
    allowed_mentions: { parse: [] },
  });
}

export async function sendDailySummary(channel, summaryData) {
  const message = buildDailySummaryMessage(summaryData);
  await channel.send(message);
}

export async function sendDailySummaryWebhook(webhookUrl, summaryData) {
  const message = buildDailySummaryMessage(summaryData);
  await postWebhookPayload(webhookUrl, { ...message, allowed_mentions: { parse: [] } });
}

export function buildHealthEmbed(health) {
  return new EmbedBuilder()
    .setColor(0x1abc9c)
    .setTitle('Job Alert Health')
    .addFields(
      {
        name: 'Runtime',
        value: [
          `Status: ${health.isRunInProgress ? 'busy' : 'idle'}`,
          `Uptime: ${health.uptime}`,
          `Next scheduled run: ${health.nextRunText}`,
        ].join('\n'),
      },
      {
        name: 'Sources',
        value: health.enabledSources.length > 0 ? health.enabledSources.join(', ') : 'No sources configured',
      },
      {
        name: 'Last Run',
        value: health.lastRunSummary
          ? [
              `Trigger: ${health.lastRunSummary.trigger}`,
              `Finished: ${health.lastRunSummary.finishedAt}`,
              `Results: ${health.lastRunSummary.totalResults}`,
              `New jobs: ${health.lastRunSummary.newJobs}`,
              `Failed sources: ${health.lastRunSummary.failedSources}`,
            ].join('\n')
          : 'No run completed yet',
      }
    );
}
