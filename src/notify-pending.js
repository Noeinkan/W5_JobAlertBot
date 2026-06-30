import { getPendingJobs, markJobNotified } from './db.js';
import {
  createDiscordClient,
  getAlertChannel,
  sendJobAlert,
  sendJobAlertsWebhook,
  sendNoNewJobsMessage,
  sendNoNewJobsMessageWebhook,
} from './discord.js';
import { env, hasDiscordBotConfig, hasDiscordWebhookConfig } from './config.js';
import { logger } from './utils/logger.js';

/**
 * Run the Discord delivery step against the existing pending rows in the DB.
 *
 * Shared between the per-cycle delivery block in `runSearchCycle` (so behavior
 * stays identical) and the dashboard's "Send pending now" button / a CLI script.
 *
 * Returns a small summary object so callers can surface it to Discord / the
 * dashboard / logs without re-implementing the logic.
 */
export async function notifyPending({ trigger = 'manual', client = null } = {}) {
  const pendingJobs = getPendingJobs();
  const triggeredAt = new Date().toISOString();
  const result = { trigger, triggeredAt, total: pendingJobs.length, sent: 0, mode: '', error: null };

  let activeClient = client;
  let createdClient = false;
  if (!activeClient && hasDiscordBotConfig()) {
    try {
      activeClient = createDiscordClient();
      await activeClient.login(env.discordToken);
      createdClient = true;
    } catch (e) {
      logger.error('notifyPending: bot login failed', { message: e.message });
      result.error = 'bot_login_failed: ' + e.message;
      // Fall through; the bot branch will be skipped below.
    }
  }

  try {
    if (pendingJobs.length === 0) {
      if (hasDiscordWebhookConfig()) {
        try {
          await sendNoNewJobsMessageWebhook(env.discordWebhookUrl);
          result.mode = 'webhook-noop';
        } catch (e) {
          result.error = e.message;
          logger.error('notifyPending: no-jobs webhook failed', { message: e.message });
        }
      } else if (activeClient && isReady(activeClient)) {
        try {
          const channel = await getAlertChannel(activeClient);
          await sendNoNewJobsMessage(channel);
          result.mode = 'bot-noop';
        } catch (e) {
          result.error = e.message;
          logger.error('notifyPending: no-jobs bot message failed', { message: e.message });
        }
      } else {
        result.mode = 'noop';
      }
      return result;
    }

    if (hasDiscordWebhookConfig()) {
      try {
        await sendJobAlertsWebhook(env.discordWebhookUrl, pendingJobs);
        for (const job of pendingJobs) markJobNotified(job);
        result.sent = pendingJobs.length;
        result.mode = 'webhook';
      } catch (e) {
        result.error = e.message;
        logger.error('notifyPending: webhook delivery failed', { message: e.message });
      }
      return result;
    }

    if (activeClient && isReady(activeClient)) {
      try {
        const channel = await getAlertChannel(activeClient);
        for (const job of pendingJobs) {
          await sendJobAlert(channel, job);
          markJobNotified(job);
        }
        result.sent = pendingJobs.length;
        result.mode = 'bot';
      } catch (e) {
        result.error = e.message;
        logger.error('notifyPending: bot delivery failed', { message: e.message });
      }
      return result;
    }

    result.error = 'No Discord delivery channel configured (need DISCORD_WEBHOOK_URL or DISCORD_TOKEN + DISCORD_CHANNEL_ID)';
    logger.error('notifyPending: ' + result.error);
    return result;
  } finally {
    if (createdClient && activeClient) {
      try { activeClient.destroy(); } catch { /* ignore */ }
    }
  }
}

function isReady(client) {
  if (!client) return false;
  return typeof client.isReady === 'function' ? client.isReady() : Boolean(client.user);
}
