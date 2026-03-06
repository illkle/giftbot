import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveChatStore } from "../../db/activeChats";
import type { CronStateStore } from "../../db/cronStateStore";
import type { FeedSeenStore } from "../../db/feedSeen";
const { getGiftInfoMock } = vi.hoisted(() => ({
  getGiftInfoMock: vi.fn(),
}));

vi.mock("../../utils", () => ({
  getGiftInfo: getGiftInfoMock,
}));

import { craftAlertsWatcherJob } from "./craftAlertsWatcher";

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { "content-type": "text/html" },
  });
}

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createContext(options: {
  initialSyncComplete: boolean | undefined;
  chats: Awaited<ReturnType<ActiveChatStore["listActiveChats"]>>;
  markSeenIfNew: FeedSeenStore["markSeenIfNew"];
  setJson?: CronStateStore["setJson"];
}) {
  const logger = createLogger();
  const state: CronStateStore = {
    getJson: async <T>() => options.initialSyncComplete as T | undefined,
    setJson:
      options.setJson ??
      (vi.fn(async () => {
        return;
      }) as CronStateStore["setJson"]),
    getNumber: vi.fn(async () => undefined),
    setNumber: vi.fn(async () => {
      return;
    }),
  };
  const activeChats: ActiveChatStore = {
    markActive: vi.fn(async () => {
      return;
    }),
    markInactive: vi.fn(async () => {
      return;
    }),
    listActiveChats: vi.fn(async (_chatType: string) => options.chats),
    listAllChats: vi.fn(async () =>
      options.chats.map((chat) => ({ ...chat, watchMode: "crafts" })),
    ),
    pruneDisabledChats: vi.fn(async () => []),
    deleteChatsByChatId: vi.fn(async (_chatId: string) => []),
  };
  const feedSeen: FeedSeenStore = {
    markSeenIfNew: vi.fn(options.markSeenIfNew),
    countSeenMessages: vi.fn(async () => 0),
  };

  return {
    logger,
    state,
    activeChats,
    feedSeen,
  };
}

describe("craftAlertsWatcherJob", () => {
  beforeEach(() => {
    getGiftInfoMock.mockResolvedValue({ estimatedPriceTon: 12.34 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    getGiftInfoMock.mockReset();
    delete process.env.CRON_TIMEZONE;
  });

  it("ignores messages that do not contain the word crafted", async () => {
    const feedHtml = `
      <div class="tgme_widget_message_wrap">
        <time datetime="2026-03-04T10:00:00Z"></time>
        <div class="tgme_widget_message_text js-message_text" dir="auto">
          Fresh alert <a href="https://t.me/nft/IGNORED">Desk Calendar #1</a>
        </div>
      </div>
      <div class="tgme_widget_message_wrap">
        <time datetime="2026-03-04T10:10:00Z"></time>
        <div class="tgme_widget_message_text js-message_text" dir="auto">
          Newly crafted <a href="https://t.me/nft/KEPT">Desk Calendar #2</a>
        </div>
      </div>
    `;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url === "https://t.me/s/craftalerts") {
          return htmlResponse(feedHtml);
        }
        throw new Error(`Unexpected URL in test: ${url}`);
      }),
    );

    const ctx = createContext({
      initialSyncComplete: undefined,
      chats: [],
      markSeenIfNew: async () => true,
    });

    const events = await craftAlertsWatcherJob.run(ctx);

    expect(events).toEqual([]);
    expect(ctx.feedSeen.markSeenIfNew).toHaveBeenCalledTimes(1);
    expect(ctx.feedSeen.markSeenIfNew).toHaveBeenCalledWith({
      source: "crafts",
      messageTime: "2026-03-04T10:10:00Z",
      nftLink: "https://t.me/nft/KEPT",
    });
    expect(ctx.activeChats.listActiveChats).not.toHaveBeenCalled();
  });

  it("routes crafted notifications only to crafts subscribers", async () => {
    const feedHtml = `
      <div class="tgme_widget_message_wrap">
        <time datetime="2026-03-04T10:20:00Z"></time>
        <div class="tgme_widget_message_text js-message_text" dir="auto">
          Freshly crafted ✨<br/><br/>🏷 <a href="https://t.me/nft/DESK">Desk Calendar #45080</a><br/>└ Shared via craftalerts
        </div>
      </div>
    `;
    const nftHtml = `
      <div class="tgme_gift_preview"><svg><text>Desk Calendar</text></svg></div>
      <table class="tgme_gift_table">
        <tr><th>Backdrop</th><td>LemonGrass Glow</td></tr>
        <tr><th>Symbol</th><td>Star</td></tr>
      </table>
    `;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url === "https://t.me/s/craftalerts") {
          return htmlResponse(feedHtml);
        }
        if (url === "https://t.me/nft/DESK") {
          return htmlResponse(nftHtml);
        }
        throw new Error(`Unexpected URL in test: ${url}`);
      }),
    );

    const ctx = createContext({
      initialSyncComplete: true,
      chats: [
        { chatId: "801", topicId: null, giftFilterConfig: null },
        { chatId: "802", topicId: null, giftFilterConfig: "backdrop:lemon" },
        { chatId: "803", topicId: null, giftFilterConfig: "symbol:shield" },
      ],
      markSeenIfNew: async () => true,
    });

    const events = await craftAlertsWatcherJob.run(ctx);

    expect(ctx.activeChats.listActiveChats).toHaveBeenCalledWith("crafts");
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.chatId)).toEqual(["801", "802"]);
    expect(events[0]?.source).toBe("craftalerts-watcher");
    expect(events[0]?.message).toContain("Freshly crafted");
    expect(events[1]?.message?.endsWith("#backdrop_lemon")).toBe(true);
  });
});
