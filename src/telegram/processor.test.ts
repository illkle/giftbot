import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config";
import type { ActiveChatStore } from "../db/activeChats";
import type { GiftWhaleFeedSeenStore } from "../db/giftWhaleFeedSeen";

const { createTelegramBotMock } = vi.hoisted(() => ({
  createTelegramBotMock: vi.fn(),
}));

vi.mock("./bot", () => ({
  createTelegramBot: createTelegramBotMock,
}));

type RegisteredHandler = (ctx: any) => Promise<void>;

type FakeBot = {
  command: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  api: { sendMessage: ReturnType<typeof vi.fn> };
  commandHandlers: Record<string, RegisteredHandler>;
  eventHandlers: Record<string, RegisteredHandler>;
};

function createFakeBot(): FakeBot {
  const commandHandlers: Record<string, RegisteredHandler> = {};
  const eventHandlers: Record<string, RegisteredHandler> = {};

  return {
    command: vi.fn((name: string, handler: RegisteredHandler) => {
      commandHandlers[name] = handler;
    }),
    on: vi.fn((name: string, handler: RegisteredHandler) => {
      eventHandlers[name] = handler;
    }),
    start: vi.fn(),
    api: {
      sendMessage: vi.fn(async () => {
        return;
      }),
    },
    commandHandlers,
    eventHandlers,
  };
}

function buildConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    telegramBotToken: "token",
    cronTimezone: "UTC",
    runJobsOnStartup: true,
    databasePath: "./data/test.sqlite",
    ...overrides,
  };
}

function buildActiveChatsStore(): ActiveChatStore {
  return {
    markActive: vi.fn(async () => {
      return;
    }),
    markInactive: vi.fn(async () => {
      return;
    }),
    listActiveChats: vi.fn(async (_chatType: string) => []),
    listAllChats: vi.fn(async () => []),
  };
}

function buildGiftWhaleFeedSeenStore(
  messageCount = 0,
): Pick<GiftWhaleFeedSeenStore, "countSeenMessages"> {
  return {
    countSeenMessages: vi.fn(async () => messageCount),
  };
}

describe("createTelegramRuntime", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("rejects /start when -c sales is missing", async () => {
    const fakeBot = createFakeBot();
    createTelegramBotMock.mockReturnValue(fakeBot);

    const { createTelegramRuntime } = await import("./processor");
    const activeChats = buildActiveChatsStore();
    const giftWhaleFeedSeen = buildGiftWhaleFeedSeenStore();
    createTelegramRuntime(buildConfig(), activeChats, giftWhaleFeedSeen);

    const reply = vi.fn(async () => {
      return;
    });
    await fakeBot.commandHandlers.start!({
      chat: { id: 42 },
      msg: { date: 0, text: "/start" },
      me: { username: "giftbot" },
      reply,
    });

    expect(activeChats.markActive).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining("Could not parse /start arguments: Missing required -c option."),
    );
  });

  it("stores topic id when /start -c sales is sent in a topic", async () => {
    const fakeBot = createFakeBot();
    createTelegramBotMock.mockReturnValue(fakeBot);

    const { createTelegramRuntime } = await import("./processor");
    const activeChats = buildActiveChatsStore();
    const giftWhaleFeedSeen = buildGiftWhaleFeedSeenStore();
    createTelegramRuntime(buildConfig(), activeChats, giftWhaleFeedSeen);

    const reply = vi.fn(async () => {
      return;
    });
    await fakeBot.commandHandlers.start!({
      chat: { id: 42 },
      msg: { message_thread_id: 999, text: "/start -c sales" },
      me: { username: "giftbot" },
      reply,
    });

    expect(activeChats.markActive).toHaveBeenCalledWith("42", 999, null);
  });

  it("rejects invalid /start filters and does not persist them", async () => {
    const fakeBot = createFakeBot();
    createTelegramBotMock.mockReturnValue(fakeBot);

    const { createTelegramRuntime } = await import("./processor");
    const activeChats = buildActiveChatsStore();
    const giftWhaleFeedSeen = buildGiftWhaleFeedSeenStore();
    createTelegramRuntime(buildConfig(), activeChats, giftWhaleFeedSeen);

    const reply = vi.fn(async () => {
      return;
    });
    await fakeBot.commandHandlers.start!({
      chat: { id: 55 },
      msg: { date: 0, text: "/start -c sales -f backdrop:lemongrass|orange" },
      me: { username: "giftbot" },
      reply,
    });

    expect(activeChats.markActive).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("Could not save filter"));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("Filter format: field:value"));
  });

  it("normalizes and stores valid /start filters", async () => {
    const fakeBot = createFakeBot();
    createTelegramBotMock.mockReturnValue(fakeBot);

    const { createTelegramRuntime } = await import("./processor");
    const activeChats = buildActiveChatsStore();
    const giftWhaleFeedSeen = buildGiftWhaleFeedSeenStore();
    createTelegramRuntime(buildConfig(), activeChats, giftWhaleFeedSeen);

    const reply = vi.fn(async () => {
      return;
    });
    await fakeBot.commandHandlers.start!({
      chat: { id: 99 },
      msg: { date: 0, text: "/start -c sales -f Backdrop: LemonGrass , symbol: Shield " },
      me: { username: "giftbot" },
      reply,
    });

    expect(activeChats.markActive).toHaveBeenCalledWith(
      "99",
      undefined,
      "backdrop:lemongrass,symbol:shield",
    );
    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining("Saved filter: backdrop:lemongrass,symbol:shield"),
    );
  });

  it("deactivates chat on /stop", async () => {
    const fakeBot = createFakeBot();
    createTelegramBotMock.mockReturnValue(fakeBot);

    const { createTelegramRuntime } = await import("./processor");
    const activeChats = buildActiveChatsStore();
    const giftWhaleFeedSeen = buildGiftWhaleFeedSeenStore();
    createTelegramRuntime(buildConfig(), activeChats, giftWhaleFeedSeen);

    const reply = vi.fn(async () => {
      return;
    });
    await fakeBot.commandHandlers.stop!({
      chat: { id: 77 },
      reply,
    });

    expect(activeChats.markInactive).toHaveBeenCalledWith("77", undefined);
    expect(reply).toHaveBeenCalledWith("Giftbot paused for this chat.");
  });

  it("routes processed events to explicit chat IDs and default chat", async () => {
    const fakeBot = createFakeBot();
    createTelegramBotMock.mockReturnValue(fakeBot);

    const { createTelegramRuntime } = await import("./processor");
    const activeChats = buildActiveChatsStore();
    const giftWhaleFeedSeen = buildGiftWhaleFeedSeenStore();
    const runtime = createTelegramRuntime(
      buildConfig({ defaultChatId: "999" }),
      activeChats,
      giftWhaleFeedSeen,
    );

    await runtime.process([
      {
        type: "info",
        source: "custom-source",
        chatId: "101",
        message: "first",
      },
      {
        type: "info",
        source: "giftwhalefeed-watcher",
        message: "watcher payload",
        metadata: { tier: 3 },
        html: true,
      },
      {
        type: "external_api_error",
        source: "giftwhalefeed-watcher",
        message: "network issue",
      },
      {
        type: "info",
        source: "giftwhalefeed-watcher",
        chatId: "101",
        topicId: 321,
        message: "topic payload",
      },
    ]);

    expect(fakeBot.api.sendMessage).toHaveBeenCalledTimes(4);
    expect(fakeBot.api.sendMessage).toHaveBeenNthCalledWith(
      1,
      "101",
      expect.stringContaining("Info (custom-source)"),
    );
    expect(fakeBot.api.sendMessage).toHaveBeenNthCalledWith(
      2,
      "999",
      expect.stringMatching(/^watcher payload\n/),
      {
        parse_mode: "HTML",
      },
    );
    expect(fakeBot.api.sendMessage).toHaveBeenNthCalledWith(
      3,
      "999",
      expect.stringContaining("API watcher error"),
    );
    expect(fakeBot.api.sendMessage).toHaveBeenNthCalledWith(
      4,
      "101",
      expect.stringMatching(/^topic payload/),
      { message_thread_id: 321 },
    );
  });

  it("skips events that have no explicit chat and no default chat", async () => {
    const fakeBot = createFakeBot();
    createTelegramBotMock.mockReturnValue(fakeBot);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      return;
    });

    const { createTelegramRuntime } = await import("./processor");
    const activeChats = buildActiveChatsStore();
    const giftWhaleFeedSeen = buildGiftWhaleFeedSeenStore();
    const runtime = createTelegramRuntime(
      buildConfig({ defaultChatId: undefined }),
      activeChats,
      giftWhaleFeedSeen,
    );

    await runtime.process([
      {
        type: "info",
        source: "test",
        message: "no target",
      },
    ]);

    expect(fakeBot.api.sendMessage).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      "Skipping event with no chat id",
      expect.objectContaining({
        source: "test",
      }),
    );
  });

  it("returns status with seen count and filter for active chat", async () => {
    const fakeBot = createFakeBot();
    createTelegramBotMock.mockReturnValue(fakeBot);

    const { createTelegramRuntime } = await import("./processor");
    const activeChats = buildActiveChatsStore();
    activeChats.listActiveChats = vi.fn(async (_chatType: string) => [
      {
        chatId: "700",
        topicId: null,
        giftFilterConfig: "backdrop:lemongrass,symbol:shield",
      },
    ]);
    const giftWhaleFeedSeen = buildGiftWhaleFeedSeenStore(1234);
    createTelegramRuntime(buildConfig(), activeChats, giftWhaleFeedSeen);

    const reply = vi.fn(async () => {
      return;
    });
    await fakeBot.commandHandlers.status!({
      chat: { id: 700 },
      reply,
    });

    expect(reply).toHaveBeenCalledWith(expect.stringContaining("I am alive."));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("I parsed 1234 messages"));
    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining("filter: backdrop:lemongrass,symbol:shield"),
    );
    expect(reply).toHaveBeenCalledWith(expect.not.stringContaining("warning:"));
  });

  it("returns status warning when chat is not active", async () => {
    const fakeBot = createFakeBot();
    createTelegramBotMock.mockReturnValue(fakeBot);

    const { createTelegramRuntime } = await import("./processor");
    const activeChats = buildActiveChatsStore();
    activeChats.listActiveChats = vi.fn(async (_chatType: string) => [
      { chatId: "701", topicId: null, giftFilterConfig: null },
    ]);
    const giftWhaleFeedSeen = buildGiftWhaleFeedSeenStore(5);
    createTelegramRuntime(buildConfig(), activeChats, giftWhaleFeedSeen);

    const reply = vi.fn(async () => {
      return;
    });
    await fakeBot.commandHandlers.status!({
      chat: { id: 9999 },
      reply,
    });

    expect(reply).toHaveBeenCalledWith(expect.stringContaining("Since start I parsed 5 messages"));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("Notifications INACTIVE"));
  });

  it("rejects /subs from non-admin chats", async () => {
    const fakeBot = createFakeBot();
    createTelegramBotMock.mockReturnValue(fakeBot);

    const { createTelegramRuntime } = await import("./processor");
    const activeChats = buildActiveChatsStore();
    const giftWhaleFeedSeen = buildGiftWhaleFeedSeenStore();
    createTelegramRuntime(buildConfig({ adminChatId: "123" }), activeChats, giftWhaleFeedSeen);

    const reply = vi.fn(async () => {
      return;
    });
    await fakeBot.commandHandlers.subs!({
      chat: { id: 999 },
      reply,
    });

    expect(activeChats.listAllChats).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith("Forbidden for 999");
  });

  it("returns all stored chats for /subs from admin chat", async () => {
    const fakeBot = createFakeBot();
    createTelegramBotMock.mockReturnValue(fakeBot);

    const { createTelegramRuntime } = await import("./processor");
    const activeChats = buildActiveChatsStore();
    activeChats.listAllChats = vi.fn(async () => [
      {
        chatId: "100",
        topicId: null,
        watchMode: "sales",
        giftFilterConfig: "backdrop:lemongrass",
      },
      {
        chatId: "200",
        topicId: 77,
        watchMode: "",
        giftFilterConfig: null,
      },
    ]);
    const giftWhaleFeedSeen = buildGiftWhaleFeedSeenStore();
    createTelegramRuntime(buildConfig({ adminChatId: "123" }), activeChats, giftWhaleFeedSeen);

    const reply = vi.fn(async () => {
      return;
    });
    await fakeBot.commandHandlers.subs!({
      chat: { id: 123 },
      reply,
    });

    expect(activeChats.listAllChats).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith(
      [
        "Subscriptions (2):",
        "chat_id=100 topic_id=none watch_mode=sales filter=backdrop:lemongrass",
        "chat_id=200 topic_id=77 watch_mode=disabled filter=none",
      ].join("\n"),
    );
  });
});
