import { load } from "cheerio";
import type { AnyNode } from "domhandler";
import type { ActiveChat } from "../../db/activeChats";
import type { BotEvent } from "../../events/types";
import {
  getMatchingGiftFilterConditions,
  parseGiftFilterConfig,
} from "../../filters/giftFilterConfig";
import type { GiftFilterConfig, GiftTableData } from "../../filters/giftFilterConfig";
import type { CronJobDefinition, CronContext } from "../types";
import { getGiftInfo } from "../../utils";

const NFT_HOST = "t.me";
const TELEGRAM_BASE_URL = "https://t.me";
const MESSAGE_TEXT_SELECTOR = ".tgme_widget_message_text.js-message_text";

type FeedMessageLink = {
  messageTime: string;
  nftLink: string;
  notificationMessageHtml: string;
};

type GiftNotificationPayload = {
  notificationMessageHtml: string;
  giftTable: GiftTableData;
  additionalInfo?: string[];
};

type ParsedGiftFilterMap = Map<string, GiftFilterConfig | null | "invalid">;

type ParsedGiftFilterState = {
  parsedFilterByChatRoute: ParsedGiftFilterMap;
  chatsWithoutFilter: number;
  chatsWithValidFilter: number;
  chatsWithInvalidFilter: number;
};

type FeedMessagePredicate = (messageText: string) => boolean;
type AdditionalGiftInfoFetcher = (slug: string) => Promise<string[]>;

type ParseFeedMessageLinksOptions = {
  includeMessage?: FeedMessagePredicate;
};

type CreateGiftFeedWatcherJobOptions = {
  name: string;
  feedUrl: string;
  initialSyncStateKey: string;
  schedule: string;
  watchMode: string;
  seenFeedSource?: string;
  includeMessage?: FeedMessagePredicate;
  getAdditionalGiftInfo?: AdditionalGiftInfoFetcher;
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeNftLink(value: string): string | undefined {
  try {
    const url = new URL(value, TELEGRAM_BASE_URL);
    if (url.hostname !== NFT_HOST || !url.pathname.startsWith("/nft/")) {
      return undefined;
    }
    return `https://${NFT_HOST}${url.pathname}`;
  } catch {
    return undefined;
  }
}

function normalizeMrktLink(value: string): string | undefined {
  try {
    const url = new URL(value, TELEGRAM_BASE_URL);
    if (url.hostname !== NFT_HOST || !url.pathname.startsWith("/mrkt/")) {
      return undefined;
    }
    return `https://${NFT_HOST}${url.pathname}${url.search}`;
  } catch {
    return undefined;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeHtmlAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

function normalizeTextNode(value: string): string {
  return value.replace(/\s+/g, " ");
}

function normalizeFeedLink(href: string, anchorText: string, nftLink: string): string | undefined {
  const normalizedNftLink = normalizeNftLink(href);
  if (normalizedNftLink === nftLink) {
    return normalizedNftLink;
  }

  if (anchorText.toUpperCase() === "MRKT") {
    return normalizeMrktLink(href);
  }

  return undefined;
}

function renderMessageNode(node: AnyNode, $: ReturnType<typeof load>, nftLink: string): string {
  if (node.type === "text") {
    const normalizedText = normalizeTextNode(node.data);
    if (!normalizedText.trim()) {
      return " ";
    }
    return escapeHtml(normalizedText);
  }

  if (node.type !== "tag") {
    return "";
  }

  const tagName = node.tagName.toLowerCase();

  if (tagName === "br") {
    return "\n";
  }

  if (tagName === "a") {
    const anchorText = normalizeWhitespace($(node).text());
    if (!anchorText) {
      return "";
    }

    const href = $(node).attr("href");
    if (!href) {
      return escapeHtml(anchorText);
    }

    const normalizedLink = normalizeFeedLink(href, anchorText, nftLink);
    if (!normalizedLink) {
      return escapeHtml(anchorText);
    }

    return `<a href="${escapeHtmlAttribute(normalizedLink)}">${escapeHtml(anchorText)}</a>`;
  }

  if (tagName === "code") {
    return escapeHtml(normalizeWhitespace($(node).text()));
  }

  return node.children.map((childNode) => renderMessageNode(childNode, $, nftLink)).join("");
}

function normalizeRenderedMessageHtml(value: string): string {
  return value
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatMatchedFilterHashtag(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return `#${normalized}`;
}

function buildNotificationMessageHtml(
  $: ReturnType<typeof load>,
  messageTextNodes: AnyNode[],
  nftLink: string,
): string {
  if (messageTextNodes.length === 0) {
    return `<a href="${escapeHtmlAttribute(nftLink)}">${escapeHtml(nftLink)}</a>`;
  }

  const rendered = messageTextNodes.map((node) => renderMessageNode(node, $, nftLink)).join("");
  const normalized = normalizeRenderedMessageHtml(rendered);

  if (!normalized) {
    return `<a href="${escapeHtmlAttribute(nftLink)}">${escapeHtml(nftLink)}</a>`;
  }

  return normalized;
}

function parseFeedMessageLinks(
  html: string,
  options: ParseFeedMessageLinksOptions = {},
): FeedMessageLink[] {
  const { includeMessage } = options;
  const $ = load(html);
  const uniqueKeys = new Set<string>();
  const results: FeedMessageLink[] = [];

  $(".tgme_widget_message_wrap").each((_, element) => {
    const messageElement = $(element);
    const messageTime = messageElement.find("time[datetime]").first().attr("datetime");
    if (!messageTime) {
      return;
    }

    const messageText = normalizeWhitespace(
      messageElement.find(MESSAGE_TEXT_SELECTOR).first().text(),
    );
    if (includeMessage && !includeMessage(messageText)) {
      return;
    }

    const messageTextNodes = messageElement
      .find(MESSAGE_TEXT_SELECTOR)
      .first()
      .contents()
      .toArray();
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
      results.push({
        messageTime,
        nftLink,
        notificationMessageHtml: buildNotificationMessageHtml($, messageTextNodes, nftLink),
      });
    }
  });

  return results;
}

function parseGiftTable(html: string): GiftTableData {
  const $ = load(html);
  const rows = $(".tgme_gift_table tr");
  const data: GiftTableData = {};
  const previewName = normalizeWhitespace(
    $(".tgme_gift_preview svg").first().find("text").first().text(),
  );

  if (previewName) {
    data.Name = previewName;
  }

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

function formatNotificationMessage(
  payload: GiftNotificationPayload,
  matchedFilterDescription?: string,
): string {
  const messageParts = [payload.notificationMessageHtml];
  const additionalInfo = payload.additionalInfo;

  if (additionalInfo && additionalInfo.length > 0) {
    messageParts.push(...additionalInfo);
  }

  if (matchedFilterDescription) {
    messageParts.push("", formatMatchedFilterHashtag(matchedFilterDescription));
  }

  return messageParts.join("\n");
}

function getChatRouteKey(chat: Pick<ActiveChat, "chatId" | "topicId">): string {
  return `${chat.chatId}:${chat.topicId ?? 0}`;
}

function formatChatRoute(chat: Pick<ActiveChat, "chatId" | "topicId">): string {
  if (chat.topicId === null) {
    return `chat ${chat.chatId}`;
  }

  return `chat ${chat.chatId} topic ${chat.topicId}`;
}

function getMatchedGiftFilterDescription(
  filterConfig: GiftFilterConfig,
  giftTable: GiftTableData,
): string | undefined {
  const matchedConditions = getMatchingGiftFilterConditions(filterConfig, giftTable);
  if (matchedConditions.length === 0) {
    return undefined;
  }

  return matchedConditions.map((condition) => `${condition.field}:${condition.value}`).join(", ");
}

function buildParsedGiftFilterState(
  chats: ActiveChat[],
  logger: Pick<Console, "warn">,
  source: string,
  runId: string,
): ParsedGiftFilterState {
  const parsedFilterByChatRoute: ParsedGiftFilterMap = new Map();
  let chatsWithoutFilter = 0;
  let chatsWithValidFilter = 0;
  let chatsWithInvalidFilter = 0;

  for (const chat of chats) {
    const chatRouteKey = getChatRouteKey(chat);
    if (!chat.giftFilterConfig) {
      parsedFilterByChatRoute.set(chatRouteKey, null);
      chatsWithoutFilter += 1;
      continue;
    }

    const parsed = parseGiftFilterConfig(chat.giftFilterConfig);
    if (!parsed.ok) {
      logger.warn(
        `[${source}] run ${runId} invalid stored filter for ${formatChatRoute(chat)}: ${parsed.error}`,
      );
      parsedFilterByChatRoute.set(chatRouteKey, "invalid");
      chatsWithInvalidFilter += 1;
      continue;
    }

    parsedFilterByChatRoute.set(chatRouteKey, parsed.config);
    chatsWithValidFilter += 1;
  }

  return {
    parsedFilterByChatRoute,
    chatsWithoutFilter,
    chatsWithValidFilter,
    chatsWithInvalidFilter,
  };
}

async function fetchTelegramPageHtml(url: string): Promise<string> {
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

const round2 = (num: number) => Math.round(num * 100) / 100;

async function getAdditionalGiftInfo(telegamUrl: string): Promise<string[]> {
  const spl = telegamUrl.split("/");
  const slug = spl[spl.length - 1];

  if (!slug) {
    throw new Error(`error, no slug from ${telegamUrl}`);
  }

  let res = `<a href="https://xgift.tg/gift-details/${slug}">xGift</a>`;

  try {
    const data = await getGiftInfo(slug);

    res += ` | Estimated: ${round2(data.estimatedPriceTon)}`;

    if (data.saleData?.salePriceTon !== undefined) {
      res += ` Market: ${round2(data.saleData.salePriceTon)}`;
    }
  } catch (e) {
    console.error(e);
  }

  return ["", res];
}

async function getCachedAdditionalGiftInfo(
  cache: Map<string, Promise<string[]>>,
  slug: string,
  fetchAdditionalGiftInfo: AdditionalGiftInfoFetcher,
): Promise<string[]> {
  const existing = cache.get(slug);
  if (existing) {
    return existing;
  }

  const pending = fetchAdditionalGiftInfo(slug).catch((error) => {
    console.error(`[giftWatcherShared] failed to load additional gift info for ${slug}`, error);
    return [];
  });
  cache.set(slug, pending);
  return pending;
}

function createGiftFeedWatcherJob(options: CreateGiftFeedWatcherJobOptions): CronJobDefinition {
  const {
    name,
    feedUrl,
    initialSyncStateKey,
    schedule,
    watchMode,
    seenFeedSource = name,
    includeMessage,
    getAdditionalGiftInfo: fetchAdditionalGiftInfo = getAdditionalGiftInfo,
  } = options;

  return {
    name,
    schedule,
    async run(ctx: CronContext): Promise<BotEvent[]> {
      const { logger, activeChats, feedSeen, state } = ctx;
      const events: BotEvent[] = [];
      const runStartedAt = Date.now();
      const runId = new Date(runStartedAt).toISOString();
      const timezone = process.env.CRON_TIMEZONE ?? "UTC";
      const additionalInfoBySlug = new Map<string, Promise<string[]>>();

      try {
        logger.info(
          `[${name}] run ${runId} fetching feed: ${feedUrl} (display_timezone=${timezone})`,
        );
        const feedHtml = await fetchTelegramPageHtml(feedUrl);
        const messageLinks = parseFeedMessageLinks(feedHtml, { includeMessage });
        logger.info(
          `[${name}] run ${runId} extracted ${messageLinks.length} message link(s) from feed`,
        );

        if (messageLinks.length === 0) {
          logger.info(`[${name}] run ${runId} no NFT links found in feed`);
          return events;
        }

        const initialSyncComplete = await state.getJson<boolean>(initialSyncStateKey);
        logger.info(
          `[${name}] run ${runId} initialSyncComplete=${String(Boolean(initialSyncComplete))}`,
        );

        if (!initialSyncComplete) {
          logger.info(
            `[${name}] run ${runId} performing initial sync for ${messageLinks.length} item(s)`,
          );
          for (const messageLink of messageLinks) {
            await feedSeen.markSeenIfNew({
              source: seenFeedSource,
              messageTime: messageLink.messageTime,
              nftLink: messageLink.nftLink,
            });
          }

          await state.setJson(initialSyncStateKey, true);
          logger.info(
            `[${name}] run ${runId} initial sync completed, marked ${messageLinks.length} item(s) as seen`,
          );
          return events;
        }

        const unseenLinks: FeedMessageLink[] = [];
        for (const messageLink of messageLinks) {
          const isNew = await feedSeen.markSeenIfNew({
            source: seenFeedSource,
            messageTime: messageLink.messageTime,
            nftLink: messageLink.nftLink,
          });
          if (isNew) {
            unseenLinks.push(messageLink);
          }
        }
        logger.info(
          `[${name}] run ${runId} detected ${unseenLinks.length} unseen item(s) out of ${messageLinks.length}`,
        );

        if (messageLinks.length > 1 && unseenLinks.length === messageLinks.length) {
          const errorMessage =
            `All parsed feed messages are unseen: ${unseenLinks.length}/${messageLinks.length}. ` +
            "Possible feed state reset or parser issue.";
          logger.error(`[${name}] run ${runId} ${errorMessage}`);
          events.push({
            type: "error",
            source: name,
            message: errorMessage,
            metadata: {
              unseenCount: unseenLinks.length,
              parsedCount: messageLinks.length,
            },
          });
        }

        if (unseenLinks.length === 0) {
          logger.info(`[${name}] run ${runId} no new messages`);
          return events;
        }

        const chats = await activeChats.listActiveChats(watchMode);
        logger.info(`[${name}] run ${runId} loaded ${chats.length} active chat(s)`);
        if (chats.length === 0) {
          logger.info(`[${name}] run ${runId} no active chats to notify`);
          return events;
        }

        const {
          parsedFilterByChatRoute,
          chatsWithoutFilter,
          chatsWithValidFilter,
          chatsWithInvalidFilter,
        } = buildParsedGiftFilterState(chats, logger, name, runId);
        logger.info(
          `[${name}] run ${runId} chat filter summary: no_filter=${chatsWithoutFilter}, valid_filter=${chatsWithValidFilter}, invalid_filter=${chatsWithInvalidFilter}`,
        );

        for (const [index, unseen] of unseenLinks.entries()) {
          try {
            logger.info(
              `[${name}] run ${runId} processing unseen ${index + 1}/${unseenLinks.length}: ${unseen.nftLink}`,
            );
            const nftHtml = await fetchTelegramPageHtml(unseen.nftLink);
            const giftTable = parseGiftTable(nftHtml);
            logger.info(
              `[${name}] run ${runId} parsed ${Object.keys(giftTable).length} gift field(s) for ${unseen.nftLink}`,
            );

            const payload: GiftNotificationPayload = {
              notificationMessageHtml: unseen.notificationMessageHtml,
              giftTable,
            };

            const recipients: Array<{
              chat: ActiveChat;
              matchedFilterDescription?: string;
            }> = [];
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

              recipients.push({ chat, matchedFilterDescription });
            }

            if (recipients.length > 0) {
              const additionalInfo = await getCachedAdditionalGiftInfo(
                additionalInfoBySlug,
                unseen.nftLink,
                fetchAdditionalGiftInfo,
              );
              if (additionalInfo.length > 0) {
                payload.additionalInfo = additionalInfo;
              }
            }

            for (const recipient of recipients) {
              const message = formatNotificationMessage(
                payload,
                recipient.matchedFilterDescription,
              );

              events.push({
                type: "info",
                source: name,
                chatId: recipient.chat.chatId,
                topicId: recipient.chat.topicId ?? undefined,
                message,
                html: true,
              });
              notifiedCount += 1;
            }
            logger.info(
              `[${name}] run ${runId} notification routing for ${unseen.nftLink}: notified=${notifiedCount}, skipped_by_filter=${skippedByFilterCount}, skipped_invalid_filter=${skippedInvalidFilterCount}`,
            );
          } catch (error) {
            logger.error(`[${name}] run ${runId} failed to process ${unseen.nftLink}`, error);
          }
        }

        logger.info(
          `[${name}] run ${runId} processed ${unseenLinks.length} new item(s), queued ${events.length} notification(s), duration_ms=${Date.now() - runStartedAt}`,
        );
        return events;
      } catch (error) {
        logger.error(`[${name}] run ${runId} failed after ${Date.now() - runStartedAt}ms`, error);
        return [
          {
            type: "error",
            source: name,
            message: `Failed to process feed: ${String(error)}`,
          },
        ];
      }
    },
  };
}

export {
  buildParsedGiftFilterState,
  createGiftFeedWatcherJob,
  fetchTelegramPageHtml,
  formatChatRoute,
  formatNotificationMessage,
  getAdditionalGiftInfo,
  getChatRouteKey,
  getCachedAdditionalGiftInfo,
  getMatchedGiftFilterDescription,
  parseFeedMessageLinks,
  parseGiftTable,
};
export type {
  AdditionalGiftInfoFetcher,
  FeedMessageLink,
  GiftNotificationPayload,
  ParsedGiftFilterState,
};
