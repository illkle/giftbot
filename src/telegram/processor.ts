import type { AppConfig } from "../config";
import type { ActiveChatStore } from "../db/activeChats";
import type { GiftWhaleFeedSeenStore } from "../db/giftWhaleFeedSeen";
import type { BotEvent } from "../events/types";
import {
  parseGiftFilterConfig,
  stringifyGiftFilterConfig,
} from "../filters/giftFilterConfig";
import { createTelegramBot } from "./bot";

type TelegramRuntime = {
  process: (events: BotEvent[]) => Promise<void>;
  startPolling: () => void;
};

type TopicContext = {
  msg?: {
    message_thread_id?: number;
  };
};

function formatEventMessage(event: BotEvent): string {
  const headerByType: Record<BotEvent["type"], string> = {
    external_api_change: "API change detected",
    external_api_error: "API watcher error",
    info: "Info",
  };

  const metadataLines = Object.entries(event.metadata ?? {}).map(
    ([key, value]) => `${key}: ${value}`,
  );

  if (event.type === "info" && event.source === "giftwhalefeed-watcher") {
    return [event.message, ...metadataLines].join("\n");
  }

  const lines = [`${headerByType[event.type]} (${event.source})`, event.message, ...metadataLines];
  return lines.join("\n");
}

function formatFilterHelpMessage(): string {
  return [
    "Filter format: field:value,other_field:value",
    "Match is case-insensitive and uses substring search.",
    "Comma-separated conditions are OR.",
    'Example: /start backdrop:lemongrass,backdrop:orange,symbol:shield',
  ].join("\n");
}

function formatStartConfirmationMessage(giftFilterConfig: string): string {
  const parsed = parseGiftFilterConfig(giftFilterConfig);
  if (!parsed.ok) {
    return [
      "Giftbot activated for this chat.",
      `Saved filter: ${giftFilterConfig}`,
      "",
      formatFilterHelpMessage(),
    ].join("\n");
  }

  const conditionLines = parsed.config.conditions.map(
    (condition) => `- ${condition.field} contains "${condition.value}"`,
  );

  return [
    "Giftbot activated for this chat.",
    `Saved filter: ${stringifyGiftFilterConfig(parsed.config)}`,
    "You will be notified when ANY condition below matches:",
    ...conditionLines,
    "",
    "Matching is case-insensitive.",
  ].join("\n");
}

function getTopicId(ctx: TopicContext): number | undefined {
  const topicId = ctx.msg?.message_thread_id;
  if (typeof topicId !== "number") {
    return undefined;
  }

  return topicId;
}

function createTelegramRuntime(
  config: AppConfig,
  activeChats: ActiveChatStore,
  giftWhaleFeedSeen: Pick<GiftWhaleFeedSeenStore, "countSeenMessages">,
): TelegramRuntime {
  const bot = createTelegramBot(config.telegramBotToken);

  bot.command("start", async (ctx) => {
    const chatId = String(ctx.chat.id);
    const topicId = getTopicId(ctx);
    const rawConfigInput = typeof ctx.match === "string" ? ctx.match.trim() : "";

    console.log("RECEIVE START COMMAND", chatId, topicId, new Date(ctx.msg.date))

    if (rawConfigInput.length === 0) {
      await activeChats.markActive(chatId, topicId, null);
      await ctx.reply(
        [
          "Giftbot activated for this chat.",
          "Filter is cleared. You will receive all gift notifications.",
          "",
          formatFilterHelpMessage(),
        ].join("\n"),
      );
      return;
    }

    const parsed = parseGiftFilterConfig(rawConfigInput);
    if (!parsed.ok) {
      await ctx.reply(
        [
          `Could not save filter: ${parsed.error}`,
          "",
          formatFilterHelpMessage(),
        ].join("\n"),
      );
      return;
    }

    const normalizedConfig = stringifyGiftFilterConfig(parsed.config);
    await activeChats.markActive(chatId, topicId, normalizedConfig);
    await ctx.reply(formatStartConfirmationMessage(normalizedConfig));
  });

  bot.command("stop", async (ctx) => {
    const chatId = String(ctx.chat.id);
    const topicId = getTopicId(ctx);
    await activeChats.markInactive(chatId, topicId);
    await ctx.reply("Giftbot paused for this chat.");
  });

  bot.command("status", async (ctx) => {
    const chatId = String(ctx.chat.id);
    const topicId = getTopicId(ctx) ?? null;
    const [activeChatList, seenMessageCount] = await Promise.all([
      activeChats.listActiveChats(),
      giftWhaleFeedSeen.countSeenMessages(),
    ]);

    const activeChat = activeChatList.find(
      (chat) => chat.chatId === chatId && chat.topicId === topicId,
    );
    const currentFilter = activeChat?.giftFilterConfig ?? null;
    const lines = [
      "alive: yes",
      `giftwhale_feed_seen: ${seenMessageCount}`,
      `filter: ${currentFilter ?? "none"}`,
    ];

    if (!activeChat) {
      lines.push("warning: this chat is not active. use /start to activate.");
    }

    await ctx.reply(lines.join("\n"));
  });

  return {
    async process(events) {
      for (const event of events) {
        const chatId = event.chatId ?? config.defaultChatId;
        if (!chatId) {
          console.warn("Skipping event with no chat id", event);
          continue;
        }

        const message = formatEventMessage(event);
        const sendOptions: { parse_mode?: "HTML"; message_thread_id?: number } = {};
        if (event.html) {
          sendOptions.parse_mode = "HTML";
        }
        if (typeof event.topicId === "number") {
          sendOptions.message_thread_id = event.topicId;
        }

        if (sendOptions.parse_mode || sendOptions.message_thread_id !== undefined) {
          await bot.api.sendMessage(chatId, message, sendOptions);
        } else {
          await bot.api.sendMessage(chatId, message);
        }
      }
    },
    startPolling() {
      void bot.start({
        onStart: () => {
          console.info("[telegram] long polling started");
        },
      });
    },
  };
}

export { createTelegramRuntime };
