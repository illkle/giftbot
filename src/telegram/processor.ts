import type { AppConfig } from "../config";
import type { ActiveChatStore } from "../db/activeChats";
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

function createTelegramRuntime(config: AppConfig, activeChats: ActiveChatStore): TelegramRuntime {
  const bot = createTelegramBot(config.telegramBotToken);

  bot.command("start", async (ctx) => {
    const chatId = String(ctx.chat.id);
    const rawConfigInput = typeof ctx.match === "string" ? ctx.match.trim() : "";

    if (rawConfigInput.length === 0) {
      await activeChats.markActive(chatId, null);
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
    await activeChats.markActive(chatId, normalizedConfig);
    await ctx.reply(formatStartConfirmationMessage(normalizedConfig));
  });

  bot.command("stop", async (ctx) => {
    const chatId = String(ctx.chat.id);
    await activeChats.markInactive(chatId);
    await ctx.reply("Giftbot paused for this chat.");
  });

  bot.on("message", async (ctx) => {
    const chatId = String(ctx.chat.id);
    await activeChats.markActive(chatId);
  });

  return {
    async process(events) {
      for (const event of events) {
        const chatId = event.chatId ?? config.defaultChatId;
        if (!chatId) {
          console.warn("Skipping event with no chat id", event);
          continue;
        }

        await bot.api.sendMessage(chatId, formatEventMessage(event));
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
