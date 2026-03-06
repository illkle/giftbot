import type { CommandContext, Context } from "grammy";
import type { AppConfig } from "../config";
import { SALES_CHAT_TYPE } from "../db/activeChats";
import type { ActiveChatStore } from "../db/activeChats";
import type { FeedSeenStore } from "../db/feedSeen";
import type { BotEvent } from "../events/types";
import { parseGiftFilterConfig, stringifyGiftFilterConfig } from "../filters/giftFilterConfig";
import { createTelegramBot } from "./bot";
import { CRAFTS_CHANNEL, parseStartArgs, SALES_CHANNEL, shouldSkipForGroupChat } from "./startArgs";

type TelegramRuntime = {
  process: (events: BotEvent[]) => Promise<void>;
  startPolling: () => void;
};

type TopicContext = CommandContext<Context>;
const WATCHER_SOURCES_WITH_RAW_HTML = new Set(["giftwhalefeed-watcher", "craftalerts-watcher"]);
const FINAL_KILL_MESSAGE = "Watching stopped. Please restart if needed";

function formatEventMessage(event: BotEvent): string {
  const headerByType: Record<BotEvent["type"], string> = {
    external_api_change: "API change detected",
    external_api_error: "API watcher error",
    info: "Info",
  };

  const metadataLines = Object.entries(event.metadata ?? {}).map(
    ([key, value]) => `${key}: ${value}`,
  );

  if (event.type === "info" && WATCHER_SOURCES_WITH_RAW_HTML.has(event.source)) {
    return [event.message, ...metadataLines].join("\n");
  }

  const lines = [`${headerByType[event.type]} (${event.source})`, event.message, ...metadataLines];
  return lines.join("\n");
}

function formatFilterHelpMessage(): string {
  return [
    `Required channel: -c ${SALES_CHANNEL} or -c ${CRAFTS_CHANNEL}.`,
    "Optional bot mention: @botusername (required in group chats).",
    "Optional filter: -f field:value,other_field:value",
    "Match is case-insensitive and uses substring search.",
    "Comma-separated conditions are OR.",
    `Example: /start -c ${SALES_CHANNEL} -f backdrop:lemongrass,backdrop:orange,symbol:shield`,
  ].join("\n");
}

function formatChannelLabel(channel: string): string {
  if (channel === SALES_CHANNEL) {
    return "sales";
  }

  if (channel === CRAFTS_CHANNEL) {
    return "crafts";
  }

  return channel;
}

function formatStartConfirmationMessage(channel: string, giftFilterConfig: string): string {
  const parsed = parseGiftFilterConfig(giftFilterConfig);
  if (!parsed.ok) {
    return [
      "Giftbot activated for this chat.",
      `Channel: ${formatChannelLabel(channel)}`,
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
    `Channel: ${formatChannelLabel(channel)}`,
    `Saved filter: ${stringifyGiftFilterConfig(parsed.config)}`,
    "You will be notified when ANY condition below matches:",
    ...conditionLines,
    "",
    "Matching is case-insensitive.",
  ].join("\n");
}

function formatStoredChatsMessage(
  chats: Awaited<ReturnType<ActiveChatStore["listAllChats"]>>,
): string {
  if (chats.length === 0) {
    return "No subscriptions found.";
  }

  const lines = chats.map((chat) =>
    [
      `chat_id=${chat.chatId}`,
      `topic_id=${chat.topicId ?? "none"}`,
      `watch_mode=${chat.watchMode || "disabled"}`,
      `filter=${chat.giftFilterConfig ?? "none"}`,
    ].join(" "),
  );

  return [`Subscriptions (${chats.length}):`, ...lines].join("\n");
}

function formatChatLocation(chat: { chatId: string; topicId: number | null }): string {
  return `chat_id=${chat.chatId} topic_id=${chat.topicId ?? "none"}`;
}

function formatRemovedChatsMessage(
  action: string,
  chats: Awaited<ReturnType<ActiveChatStore["listAllChats"]>>,
): string {
  if (chats.length === 0) {
    return `${action}: nothing to remove.`;
  }

  return [
    `${action}: removed ${chats.length} subscription(s).`,
    ...chats.map(formatChatLocation),
  ].join("\n");
}

function getTopicId(ctx: TopicContext): number | undefined {
  const topicId = ctx.msg?.message_thread_id;
  if (typeof topicId !== "number") {
    return undefined;
  }

  return topicId;
}

function isGroupChat(chatType: string | undefined): boolean {
  return chatType === "group" || chatType === "supergroup";
}

function shouldSkipCommandWithoutMention(ctx: TopicContext): boolean {
  if (!isGroupChat(ctx.chat.type)) {
    return false;
  }

  const hasMention = ctx.msg?.text.toLowerCase().includes(ctx.me.username?.toLowerCase());

  return !hasMention;
}

function isAdminChat(config: AppConfig, chatId: string): boolean {
  return Boolean(config.adminChatId && chatId === config.adminChatId);
}

function getCommandArgument(ctx: TopicContext): string | undefined {
  const text = ctx.msg?.text?.trim();
  if (!text) {
    return undefined;
  }

  const [, ...parts] = text.split(/\s+/);
  return parts[0];
}

function createTelegramRuntime(
  config: AppConfig,
  activeChats: ActiveChatStore,
  feedSeen: Pick<FeedSeenStore, "countSeenMessages">,
): TelegramRuntime {
  const bot = createTelegramBot(config.telegramBotToken);

  bot.command("start", async (ctx) => {
    const chatId = String(ctx.chat.id);
    const topicId = getTopicId(ctx);
    const parsedArgs = parseStartArgs({
      text: ctx.msg?.text,
      chatType: ctx.chat.type,
      botUsername: ctx.me.username,
    });

    console.log("RECEIVE START COMMAND", chatId, topicId, ctx.msg?.date);

    if (shouldSkipForGroupChat(parsedArgs)) {
      return;
    }

    if (parsedArgs.error) {
      await ctx.reply(
        [
          `Could not parse /start arguments: ${parsedArgs.error}`,
          "",
          formatFilterHelpMessage(),
        ].join("\n"),
      );
      return;
    }

    if (parsedArgs.filter === null) {
      await activeChats.markActive(chatId, topicId, null, parsedArgs.channel ?? SALES_CHANNEL);
      await ctx.reply(
        [
          "Giftbot activated for this chat.",
          `Channel: ${formatChannelLabel(parsedArgs.channel ?? SALES_CHANNEL)}`,
          "Filter is cleared. You will receive all matching gift notifications.",
          "",
          formatFilterHelpMessage(),
        ].join("\n"),
      );
      return;
    }

    const parsed = parseGiftFilterConfig(parsedArgs.filter);
    if (!parsed.ok) {
      await ctx.reply(
        [`Could not save filter: ${parsed.error}`, "", formatFilterHelpMessage()].join("\n"),
      );
      return;
    }

    const normalizedConfig = stringifyGiftFilterConfig(parsed.config);
    await activeChats.markActive(
      chatId,
      topicId,
      normalizedConfig,
      parsedArgs.channel ?? SALES_CHANNEL,
    );
    await ctx.reply(
      formatStartConfirmationMessage(parsedArgs.channel ?? SALES_CHANNEL, normalizedConfig),
    );
  });

  bot.command("stop", async (ctx) => {
    console.log("RECEIVED stop command");

    if (shouldSkipCommandWithoutMention(ctx)) {
      return;
    }

    const chatId = String(ctx.chat.id);
    const topicId = getTopicId(ctx);
    await activeChats.markInactive(chatId, topicId);
    await ctx.reply("Giftbot paused for this chat.");
  });

  bot.command("status", async (ctx) => {
    console.log("RECEIVED status command");

    if (shouldSkipCommandWithoutMention(ctx)) {
      return;
    }

    const chatId = String(ctx.chat.id);
    const topicId = getTopicId(ctx) ?? null;
    const [activeChatList, seenMessageCount] = await Promise.all([
      activeChats.listAllChats(),
      feedSeen.countSeenMessages(),
    ]);

    const activeChat = activeChatList.find(
      (chat) => chat.chatId === chatId && chat.topicId === topicId && chat.watchMode !== "",
    );
    const currentFilter = activeChat?.giftFilterConfig ?? null;
    const currentMode = activeChat?.watchMode ?? null;
    const lines = [
      `I am alive. Since start I parsed ${seenMessageCount} messages`,
      `Notifications ${
        activeChat ? `ACTIVE (${formatChannelLabel(currentMode ?? SALES_CHAT_TYPE)})` : "INACTIVE"
      }`,
      activeChat && `filter: ${currentFilter ?? "none"}`,
    ];

    await ctx.reply(lines.join("\n"));
  });

  bot.command("subs", async (ctx) => {
    const chatId = String(ctx.chat.id);
    if (!isAdminChat(config, chatId)) {
      await ctx.reply(`Forbidden for ${ctx.chat.id}`);
      return;
    }

    const chats = await activeChats.listAllChats();
    await ctx.reply(formatStoredChatsMessage(chats));
  });

  bot.command("prune", async (ctx) => {
    const chatId = String(ctx.chat.id);
    if (!isAdminChat(config, chatId)) {
      await ctx.reply(`Forbidden for ${ctx.chat.id}`);
      return;
    }

    const removedChats = await activeChats.pruneDisabledChats();
    await ctx.reply(formatRemovedChatsMessage("Prune complete", removedChats));
  });

  bot.command("kill", async (ctx) => {
    const requesterChatId = String(ctx.chat.id);
    if (!isAdminChat(config, requesterChatId)) {
      await ctx.reply(`Forbidden for ${ctx.chat.id}`);
      return;
    }

    const targetChatId = getCommandArgument(ctx);
    if (!targetChatId) {
      await ctx.reply("Usage: /kill <chat_id>");
      return;
    }

    const removedChats = await activeChats.deleteChatsByChatId(targetChatId);
    if (removedChats.length === 0) {
      await ctx.reply(`No subscriptions found for chat_id=${targetChatId}.`);
      return;
    }

    const sendResults = await Promise.allSettled(
      removedChats.map((chat) => {
        const sendOptions = chat.topicId === null ? undefined : { message_thread_id: chat.topicId };
        if (sendOptions) {
          return bot.api.sendMessage(chat.chatId, FINAL_KILL_MESSAGE, sendOptions);
        }

        return bot.api.sendMessage(chat.chatId, FINAL_KILL_MESSAGE);
      }),
    );

    const failedChats = removedChats.filter(
      (_chat, index) => sendResults[index]?.status === "rejected",
    );
    const responseLines = [formatRemovedChatsMessage("Kill complete", removedChats)];
    if (failedChats.length > 0) {
      responseLines.push(`Final message failed for ${failedChats.length} destination(s).`);
      responseLines.push(...failedChats.map(formatChatLocation));
    }

    await ctx.reply(responseLines.join("\n"));
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
