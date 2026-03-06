import type { BotEvent } from "../../events/types";
import type { CronJobDefinition } from "../types";
import {
  buildParsedGiftFilterState,
  fetchTelegramPageHtml,
  formatNotificationMessage,
  getChatRouteKey,
  getMatchedGiftFilterDescription,
  parseFeedMessageLinks,
  parseGiftTable,
} from "./giftWatcherShared";
import type { FeedMessageLink, GiftNotificationPayload } from "./giftWatcherShared";

const FEED_URL = "https://t.me/s/giftwhalefeed";
const INITIAL_SYNC_STATE_KEY = "giftwhalefeed-watcher:initial-sync-complete";

export const giftWhaleFeedWatcherJob: CronJobDefinition = {
  name: "giftwhalefeed-watcher",
  schedule: "*/1 * * * *",
  async run(ctx) {
    const { logger, activeChats, giftWhaleFeedSeen, state } = ctx;
    const events: BotEvent[] = [];
    const runStartedAt = Date.now();
    const runId = new Date(runStartedAt).toISOString();
    const timezone = process.env.CRON_TIMEZONE ?? "UTC";

    try {
      logger.info(
        `[giftwhalefeed-watcher] run ${runId} fetching feed: ${FEED_URL} (display_timezone=${timezone})`,
      );
      const feedHtml = await fetchTelegramPageHtml(FEED_URL);
      const messageLinks = parseFeedMessageLinks(feedHtml);
      logger.info(
        `[giftwhalefeed-watcher] run ${runId} extracted ${messageLinks.length} message link(s) from feed`,
      );

      if (messageLinks.length === 0) {
        logger.info(`[giftwhalefeed-watcher] run ${runId} no NFT links found in feed`);
        return events;
      }

      const initialSyncComplete = await state.getJson<boolean>(INITIAL_SYNC_STATE_KEY);
      logger.info(
        `[giftwhalefeed-watcher] run ${runId} initialSyncComplete=${String(Boolean(initialSyncComplete))}`,
      );

      if (!initialSyncComplete) {
        logger.info(
          `[giftwhalefeed-watcher] run ${runId} performing initial sync for ${messageLinks.length} item(s)`,
        );
        for (const messageLink of messageLinks) {
          await giftWhaleFeedSeen.markSeenIfNew(messageLink);
        }

        await state.setJson(INITIAL_SYNC_STATE_KEY, true);
        logger.info(
          `[giftwhalefeed-watcher] run ${runId} initial sync completed, marked ${messageLinks.length} item(s) as seen`,
        );
        return events;
      }

      const unseenLinks: FeedMessageLink[] = [];
      for (const messageLink of messageLinks) {
        const isNew = await giftWhaleFeedSeen.markSeenIfNew(messageLink);
        if (isNew) {
          unseenLinks.push(messageLink);
        }
      }
      logger.info(
        `[giftwhalefeed-watcher] run ${runId} detected ${unseenLinks.length} unseen item(s) out of ${messageLinks.length}`,
      );

      if (unseenLinks.length === 0) {
        logger.info(`[giftwhalefeed-watcher] run ${runId} no new messages`);
        return events;
      }

      const chats = await activeChats.listActiveChats();
      logger.info(`[giftwhalefeed-watcher] run ${runId} loaded ${chats.length} active chat(s)`);
      if (chats.length === 0) {
        logger.info(`[giftwhalefeed-watcher] run ${runId} no active chats to notify`);
        return events;
      }

      const {
        parsedFilterByChatRoute,
        chatsWithoutFilter,
        chatsWithValidFilter,
        chatsWithInvalidFilter,
      } = buildParsedGiftFilterState(chats, logger, "giftwhalefeed-watcher", runId);
      logger.info(
        `[giftwhalefeed-watcher] run ${runId} chat filter summary: no_filter=${chatsWithoutFilter}, valid_filter=${chatsWithValidFilter}, invalid_filter=${chatsWithInvalidFilter}`,
      );

      for (const [index, unseen] of unseenLinks.entries()) {
        try {
          logger.info(
            `[giftwhalefeed-watcher] run ${runId} processing unseen ${index + 1}/${unseenLinks.length}: ${unseen.nftLink}`,
          );
          const nftHtml = await fetchTelegramPageHtml(unseen.nftLink);
          const giftTable = parseGiftTable(nftHtml);
          logger.info(
            `[giftwhalefeed-watcher] run ${runId} parsed ${Object.keys(giftTable).length} gift field(s) for ${unseen.nftLink}`,
          );

          const payload: GiftNotificationPayload = {
            notificationMessageHtml: unseen.notificationMessageHtml,
            giftTable,
          };

          let notifiedCount = 0;
          let skippedByFilterCount = 0;
          let skippedInvalidFilterCount = 0;

          for (const chat of chats) {
            const filterConfig = parsedFilterByChatRoute.get(getChatRouteKey(chat));
            if (filterConfig === "invalid") {
              skippedInvalidFilterCount += 1;
              continue;
            }

            let matchedFilterDescription: string | undefined;
            if (filterConfig) {
              matchedFilterDescription = getMatchedGiftFilterDescription(filterConfig, giftTable);
              if (!matchedFilterDescription) {
                skippedByFilterCount += 1;
                continue;
              }
            }

            const message = formatNotificationMessage(payload, matchedFilterDescription);

            events.push({
              type: "info",
              source: "giftwhalefeed-watcher",
              chatId: chat.chatId,
              topicId: chat.topicId ?? undefined,
              message,
              html: true,
            });
            notifiedCount += 1;
          }
          logger.info(
            `[giftwhalefeed-watcher] run ${runId} notification routing for ${unseen.nftLink}: notified=${notifiedCount}, skipped_by_filter=${skippedByFilterCount}, skipped_invalid_filter=${skippedInvalidFilterCount}`,
          );
        } catch (error) {
          logger.error(
            `[giftwhalefeed-watcher] run ${runId} failed to process ${unseen.nftLink}`,
            error,
          );
        }
      }

      logger.info(
        `[giftwhalefeed-watcher] run ${runId} processed ${unseenLinks.length} new item(s), queued ${events.length} notification(s), duration_ms=${Date.now() - runStartedAt}`,
      );
      return events;
    } catch (error) {
      logger.error(
        `[giftwhalefeed-watcher] run ${runId} failed after ${Date.now() - runStartedAt}ms`,
        error,
      );
      return [
        {
          type: "external_api_error",
          source: "giftwhalefeed-watcher",
          message: `Failed to process feed: ${String(error)}`,
        },
      ];
    }
  },
};
