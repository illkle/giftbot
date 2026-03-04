import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config";
import type { ActiveChatStore } from "../db/activeChats";

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
    listActiveChats: vi.fn(async () => []),
  };
}

describe("createTelegramRuntime", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("clears filter when /start is sent without args", async () => {
    const fakeBot = createFakeBot();
    createTelegramBotMock.mockReturnValue(fakeBot);

    const { createTelegramRuntime } = await import("./processor");
    const activeChats = buildActiveChatsStore();
    createTelegramRuntime(buildConfig(), activeChats);

    const reply = vi.fn(async () => {
      return;
    });
    await fakeBot.commandHandlers.start!({
      chat: { id: 42 },
      match: "   ",
      reply,
    });

    expect(activeChats.markActive).toHaveBeenCalledWith("42", null);
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("Filter is cleared."));
  });

  it("rejects invalid /start filters and does not persist them", async () => {
    const fakeBot = createFakeBot();
    createTelegramBotMock.mockReturnValue(fakeBot);

    const { createTelegramRuntime } = await import("./processor");
    const activeChats = buildActiveChatsStore();
    createTelegramRuntime(buildConfig(), activeChats);

    const reply = vi.fn(async () => {
      return;
    });
    await fakeBot.commandHandlers.start!({
      chat: { id: 55 },
      match: "backdrop:lemongrass|orange",
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
    createTelegramRuntime(buildConfig(), activeChats);

    const reply = vi.fn(async () => {
      return;
    });
    await fakeBot.commandHandlers.start!({
      chat: { id: 99 },
      match: " Backdrop: LemonGrass , symbol: Shield ",
      reply,
    });

    expect(activeChats.markActive).toHaveBeenCalledWith(
      "99",
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
    createTelegramRuntime(buildConfig(), activeChats);

    const reply = vi.fn(async () => {
      return;
    });
    await fakeBot.commandHandlers.stop!({
      chat: { id: 77 },
      reply,
    });

    expect(activeChats.markInactive).toHaveBeenCalledWith("77");
    expect(reply).toHaveBeenCalledWith("Giftbot paused for this chat.");
  });

  it("routes processed events to explicit chat IDs and default chat", async () => {
    const fakeBot = createFakeBot();
    createTelegramBotMock.mockReturnValue(fakeBot);

    const { createTelegramRuntime } = await import("./processor");
    const activeChats = buildActiveChatsStore();
    const runtime = createTelegramRuntime(buildConfig({ defaultChatId: "999" }), activeChats);

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
      },
      {
        type: "external_api_error",
        source: "giftwhalefeed-watcher",
        message: "network issue",
      },
    ]);

    expect(fakeBot.api.sendMessage).toHaveBeenCalledTimes(3);
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
  });

  it("skips events that have no explicit chat and no default chat", async () => {
    const fakeBot = createFakeBot();
    createTelegramBotMock.mockReturnValue(fakeBot);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      return;
    });

    const { createTelegramRuntime } = await import("./processor");
    const activeChats = buildActiveChatsStore();
    const runtime = createTelegramRuntime(buildConfig({ defaultChatId: undefined }), activeChats);

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
});
