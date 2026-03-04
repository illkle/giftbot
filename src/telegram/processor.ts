import type { AppConfig } from "../config";
import type { BotEvent } from "../events/types";
import { createTelegramBot } from "./bot";

type TelegramEventProcessor = {
  process: (events: BotEvent[]) => Promise<void>;
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

function createTelegramEventProcessor(config: AppConfig): TelegramEventProcessor {
  const bot = createTelegramBot(config.telegramBotToken);

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
  };
}

export { createTelegramEventProcessor };
