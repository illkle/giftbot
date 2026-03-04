import { load } from "cheerio";
import {
  matchesGiftFilterConfig,
  parseGiftFilterConfig,
} from "../../filters/giftFilterConfig";
import type { GiftFilterConfig, GiftTableData } from "../../filters/giftFilterConfig";
import type { BotEvent } from "../../events/types";
import type { CronJobDefinition } from "../types";

const FEED_URL = "https://t.me/s/giftwhalefeed";
const NFT_HOST = "t.me";
const INITIAL_SYNC_STATE_KEY = "giftwhalefeed-watcher:initial-sync-complete";

type FeedMessageLink = {
  messageTime: string;
  nftLink: string;
};

type GiftNotificationPayload = {
  messageTime: string;
  nftLink: string;
  giftTable: GiftTableData;
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeNftLink(value: string): string | undefined {
  try {
    const url = new URL(value, "https://t.me");
    if (url.hostname !== NFT_HOST || !url.pathname.startsWith("/nft/")) {
      return undefined;
    }
    return `https://${NFT_HOST}${url.pathname}`;
  } catch {
    return undefined;
  }
}

function parseFeedMessageLinks(html: string): FeedMessageLink[] {
  const $ = load(html);
  const uniqueKeys = new Set<string>();
  const results: FeedMessageLink[] = [];

  $(".tgme_widget_message_wrap").each((_, element) => {
    const messageElement = $(element);
    const messageTime = messageElement.find("time[datetime]").first().attr("datetime");
    if (!messageTime) {
      return;
    }

    const linksInMessage = new Set<string>();
    messageElement.find("a[href]").each((__, anchor) => {
      const href = $(anchor).attr("href");
      if (!href) {
        return;
      }
      const nftLink = normalizeNftLink(href);
      if (nftLink) {
        linksInMessage.add(nftLink);
      }
    });

    for (const nftLink of linksInMessage) {
      const key = `${messageTime}::${nftLink}`;
      if (uniqueKeys.has(key)) {
        continue;
      }
      uniqueKeys.add(key);
      results.push({ messageTime, nftLink });
    }
  });

  return results;
}

function parseGiftTable(html: string): GiftTableData {
  const $ = load(html);
  const rows = $(".tgme_gift_table tr");
  const data: GiftTableData = {};

  rows.each((_, row) => {
    const rowElement = $(row);
    const key = normalizeWhitespace(rowElement.find("th").first().text());
    const value = normalizeWhitespace(rowElement.find("td").first().text());

    if (!key || !value) {
      return;
    }

    data[key] = value;
  });

  return data;
}

function formatNotificationMessage(payload: GiftNotificationPayload): string {
  const giftRows = Object.entries(payload.giftTable).map(([key, value]) => `${key}: ${value}`);
  return [
    `Time: ${payload.messageTime}`,
    ...(giftRows.length > 0 ? ["", ...giftRows] : []),
    "",
    `NFT: ${payload.nftLink}`,
  ].join("\n");
}

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  return response.text();
}

export const giftWhaleFeedWatcherJob: CronJobDefinition = {
  name: "giftwhalefeed-watcher",
  schedule: "*/1 * * * *",
  async run(ctx) {
    const { logger, activeChats, giftWhaleFeedSeen, state } = ctx;
    const events: BotEvent[] = [];
    const runStartedAt = Date.now();
    const runId = new Date(runStartedAt).toISOString();

    try {
      logger.info(`[giftwhalefeed-watcher] run ${runId} fetching feed: ${FEED_URL}`);
      const feedHtml = await fetchHtml(FEED_URL);
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

      const parsedFilterByChatId = new Map<string, GiftFilterConfig | null | "invalid">();
      let chatsWithoutFilter = 0;
      let chatsWithValidFilter = 0;
      let chatsWithInvalidFilter = 0;

      for (const chat of chats) {
        if (!chat.giftFilterConfig) {
          parsedFilterByChatId.set(chat.chatId, null);
          chatsWithoutFilter += 1;
          continue;
        }

        const parsed = parseGiftFilterConfig(chat.giftFilterConfig);
        if (!parsed.ok) {
          logger.warn(
            `[giftwhalefeed-watcher] run ${runId} invalid stored filter for chat ${chat.chatId}: ${parsed.error}`,
          );
          parsedFilterByChatId.set(chat.chatId, "invalid");
          chatsWithInvalidFilter += 1;
          continue;
        }

        parsedFilterByChatId.set(chat.chatId, parsed.config);
        chatsWithValidFilter += 1;
      }
      logger.info(
        `[giftwhalefeed-watcher] run ${runId} chat filter summary: no_filter=${chatsWithoutFilter}, valid_filter=${chatsWithValidFilter}, invalid_filter=${chatsWithInvalidFilter}`,
      );

      for (const [index, unseen] of unseenLinks.entries()) {
        try {
          logger.info(
            `[giftwhalefeed-watcher] run ${runId} processing unseen ${index + 1}/${unseenLinks.length}: ${unseen.nftLink}`,
          );
          const nftHtml = await fetchHtml(unseen.nftLink);
          const giftTable = parseGiftTable(nftHtml);
          logger.info(
            `[giftwhalefeed-watcher] run ${runId} parsed ${Object.keys(giftTable).length} gift field(s) for ${unseen.nftLink}`,
          );

          const payload: GiftNotificationPayload = {
            messageTime: unseen.messageTime,
            nftLink: unseen.nftLink,
            giftTable,
          };

          const message = formatNotificationMessage(payload);
          let notifiedCount = 0;
          let skippedByFilterCount = 0;
          let skippedInvalidFilterCount = 0;

          for (const chat of chats) {
            const filterConfig = parsedFilterByChatId.get(chat.chatId);
            if (filterConfig === "invalid") {
              skippedInvalidFilterCount += 1;
              continue;
            }

            if (filterConfig && !matchesGiftFilterConfig(filterConfig, giftTable)) {
              skippedByFilterCount += 1;
              continue;
            }

            events.push({
              type: "info",
              source: "giftwhalefeed-watcher",
              chatId: chat.chatId,
              message,
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
