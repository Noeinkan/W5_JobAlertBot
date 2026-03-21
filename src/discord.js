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

export function buildJobEmbed(job) {
  const color = job.isContract ? 0x3498db : 0x2ecc71;
  const banner = job.isContract ? 'CONTRACT ROLE' : 'NEW JOB ALERT';
  const tags = job.tags?.length > 0
    ? job.tags.map((tag) => `#${tag}`).join(' ')
    : `#${job.searchId} ${job.isContract ? '#contract' : '#permanent'}`;

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`${job.isContract ? '🔵' : '🟢'} ${banner}`)
    .setDescription([
      `**${job.title}**`,
      `🏢 ${job.company || 'Unknown company'}`,
      `📍 ${job.location || 'Location not listed'}`,
      `💰 ${job.salaryText || 'Salary not listed'}`,
      `📅 Posted: ${getPostedText(job.postedAt)}`,
      `🔗 Source: ${getSourceLabel(job.source)}`,
      `[Apply Here](${job.url})`,
      `Tags: ${tags}`,
    ].join('\n'));
}

export async function sendJobAlert(channel, job) {
  await channel.send({
    embeds: [buildJobEmbed(job)],
  });
}

export async function sendJobAlertWebhook(webhookUrl, job) {
  await axios.post(webhookUrl, {
    embeds: [buildJobEmbed(job).toJSON()],
    allowed_mentions: { parse: [] },
  });
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

  await axios.post(webhookUrl, {
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
