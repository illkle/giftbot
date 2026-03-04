import type { AppConfig } from "../config";
import type { ActiveChatStore } from "../db/activeChats";
import type { BotEvent } from "../events/types";
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

  const lines = [`${headerByType[event.type]} (${event.source})`, event.message, ...metadataLines];
  return lines.join("\n");
}

function createTelegramRuntime(config: AppConfig, activeChats: ActiveChatStore): TelegramRuntime {
  const bot = createTelegramBot(config.telegramBotToken);

  bot.command("start", async (ctx) => {
    const chatId = String(ctx.chat.id);
    await activeChats.markActive(chatId);
    await ctx.reply("Giftbot activated for this chat.");
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
