import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActiveChatStore } from "../../db/activeChats";
import type { CronStateStore } from "../../db/cronStateStore";
import type { FeedSeenStore } from "../../db/feedSeen";

type GetGiftInfo = typeof import("../../utils").getGiftInfo;

const { getGiftInfoMock } = vi.hoisted(() => ({
  getGiftInfoMock: vi.fn<GetGiftInfo>(),
}));

vi.mock("../../utils", () => ({
  getGiftInfo: getGiftInfoMock,
}));

import {
  type AdditionalGiftInfoFetcher,
  createGiftFeedWatcherJob,
  formatNotificationMessage,
  getAdditionalGiftInfo,
  parseFeedMessageLinks,
} from "./giftWatcherShared";

const originalFetch: typeof globalThis.fetch = globalThis.fetch;

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
  chats: Awaited<ReturnType<ActiveChatStore["listActiveChats"]>>;
  markSeenIfNew?: FeedSeenStore["markSeenIfNew"];
}) {
  const logger = createLogger();
  const state: CronStateStore = {
    getJson: async <T>() => true as T,
    setJson: vi.fn(async () => {
      return;
    }) as CronStateStore["setJson"],
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
    listAllChats: vi.fn(async () => options.chats.map((chat) => ({ ...chat, watchMode: "sales" }))),
    pruneDisabledChats: vi.fn(async () => []),
    deleteChatsByChatId: vi.fn(async (_chatId: string) => []),
  };
  const feedSeen: FeedSeenStore = {
    markSeenIfNew: vi.fn(options.markSeenIfNew ?? (async () => true)),
    countSeenMessages: vi.fn(async () => 0),
  };

  return {
    logger,
    telegramBaseUrl: "https://t.me",
    state,
    activeChats,
    feedSeen,
  };
}

function mockFetch(
  handler: (url: string) => Promise<Response>,
): ReturnType<typeof vi.fn<(input: Parameters<typeof fetch>[0]) => Promise<Response>>> {
  const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    if (typeof input === "string" || input instanceof URL) {
      return handler(String(input));
    }

    return handler(input.url);
  });

  const wrappedFetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) =>
      fetchMock(input),
    originalFetch,
  );

  globalThis.fetch = wrappedFetch;
  return fetchMock;
}

function createTestJob(getAdditionalGiftInfo?: AdditionalGiftInfoFetcher) {
  return createGiftFeedWatcherJob({
    name: "giftwatcher-shared-test",
    feedPath: "/s/testfeed",
    initialSyncStateKey: "giftwatcher-shared-test:initial-sync-complete",
    schedule: "* * * * *",
    watchMode: "sales",
    getAdditionalGiftInfo,
  });
}

describe("giftWatcherShared", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    getGiftInfoMock.mockReset();
    globalThis.fetch = originalFetch;
  });

  it("appends additional info before the hashtag", () => {
    const message = formatNotificationMessage(
      {
        notificationMessageHtml: "base message",
        giftTable: {},
        additionalInfo: ["rarity 2.1%", "<unsafe>"],
      },
      "backdrop:lemon",
    );

    expect(message).toBe("base message\nrarity 2.1%\n<unsafe>\n\n#backdrop_lemon");
  });

  it("returns xGift pricing info from getGiftInfo", async () => {
    getGiftInfoMock.mockResolvedValue({
      estimatedPriceTon: 12.345,
      saleData: { salePriceTon: 67.891 },
    });

    await expect(getAdditionalGiftInfo("https://t.me/nft/CACHED")).resolves.toEqual([
      "",
      '<a href="https://xgift.tg/gift-details/CACHED">xGift</a> | Estimated: 12.35 Market: 67.89',
    ]);
    expect(getGiftInfoMock).toHaveBeenCalledTimes(1);
    expect(getGiftInfoMock).toHaveBeenCalledWith("CACHED");
  });

  it("keeps the xGift link when getGiftInfo fails", async () => {
    const error = new Error("boom");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {
      return;
    });
    getGiftInfoMock.mockRejectedValue(error);

    await expect(getAdditionalGiftInfo("https://t.me/nft/FAILED")).resolves.toEqual([
      "",
      '<a href="https://xgift.tg/gift-details/FAILED">xGift</a>',
    ]);
    expect(consoleError).toHaveBeenCalledWith(error);
  });

  it("accepts NFT links from both Telegram web domains", () => {
    const html = `
      <div class="tgme_widget_message_wrap">
        <time datetime="2026-07-14T10:00:00Z"></time>
        <div class="tgme_widget_message_text js-message_text">
          <a href="https://t.me/nft/HeartLocket-346">t.me</a>
          <a href="https://telegram.me/nft/HeartLocket-346">telegram.me</a>
        </div>
      </div>
    `;

    expect(parseFeedMessageLinks(html)).toEqual([
      expect.objectContaining({
        messageTime: "2026-07-14T10:00:00Z",
        nftLink: "https://t.me/nft/HeartLocket-346",
      }),
    ]);
  });

  it("fetches and renders with the configured Telegram base URL", async () => {
    const getAdditionalInfo = vi.fn(async () => []);
    const job = createTestJob(getAdditionalInfo);
    const ctx = createContext({
      chats: [{ chatId: "101", topicId: null, giftFilterConfig: null }],
    });
    ctx.telegramBaseUrl = "https://telegram.me";
    const feedHtml = `
      <div class="tgme_widget_message_wrap">
        <time datetime="2026-07-14T10:00:00Z"></time>
        <div class="tgme_widget_message_text js-message_text">
          🏷 <a href="https://t.me/nft/HeartLocket-346">Heart Locket #346</a><br/>
          └ Sold on <a href="https://t.me/mrkt/app?startapp=123">MRKT</a>
        </div>
      </div>
    `;

    const fetchMock = mockFetch(async (url) => {
      if (url === "https://telegram.me/s/testfeed") {
        return htmlResponse(feedHtml);
      }
      if (url === "https://telegram.me/nft/HeartLocket-346") {
        return htmlResponse('<table class="tgme_gift_table"></table>');
      }
      throw new Error(`Unexpected URL in test: ${url}`);
    });

    const events = await job.run(ctx);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(ctx.feedSeen.markSeenIfNew).toHaveBeenCalledWith({
      source: "giftwatcher-shared-test",
      messageTime: "2026-07-14T10:00:00Z",
      nftLink: "https://t.me/nft/HeartLocket-346",
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.message).toContain(
      '<a href="https://telegram.me/nft/HeartLocket-346">Heart Locket #346</a>',
    );
    expect(events[0]?.message).toContain(
      '<a href="https://telegram.me/mrkt/app?startapp=123">MRKT</a>',
    );
  });

  it("loads additional info once per gift and reuses it across recipients", async () => {
    getGiftInfoMock.mockResolvedValue({
      estimatedPriceTon: 15.678,
      saleData: { salePriceTon: 9.876 },
    });
    const job = createTestJob();
    const ctx = createContext({
      chats: [
        { chatId: "101", topicId: null, giftFilterConfig: null },
        { chatId: "102", topicId: null, giftFilterConfig: "backdrop:lemon" },
      ],
    });
    const feedHtml = `
      <div class="tgme_widget_message_wrap">
        <time datetime="2026-03-04T10:20:00Z"></time>
        <div class="tgme_widget_message_text js-message_text" dir="auto">
          🎉 GIFT SOLD!<br/><br/>🏷 <a href="https://t.me/nft/CACHED">Cached Gift #1</a><br/>└ Sold on <a href="https://t.me/mrkt/app?startapp=123">MRKT</a>
        </div>
      </div>
    `;
    const nftHtml = `
      <table class="tgme_gift_table">
        <tr><th>Backdrop</th><td>LemonGrass Glow</td></tr>
      </table>
    `;

    mockFetch(async (url) => {
      if (url === "https://t.me/s/testfeed") {
        return htmlResponse(feedHtml);
      }
      if (url === "https://t.me/nft/CACHED") {
        return htmlResponse(nftHtml);
      }
      throw new Error(`Unexpected URL in test: ${url}`);
    });

    const events = await job.run(ctx);

    expect(events).toHaveLength(2);
    expect(events[0]?.message).toContain(
      '\n\n<a href="https://xgift.tg/gift-details/CACHED">xGift</a> | Estimated: 15.68 Market: 9.88',
    );
    expect(events[1]?.message).toContain(
      '\n\n<a href="https://xgift.tg/gift-details/CACHED">xGift</a> | Estimated: 15.68 Market: 9.88\n\n#backdrop_lemon',
    );
    expect(getGiftInfoMock).toHaveBeenCalledTimes(1);
    expect(getGiftInfoMock).toHaveBeenCalledWith("CACHED");
    expect(ctx.activeChats.listActiveChats).toHaveBeenCalledWith("sales");
  });

  it("skips loading additional info when no chat will receive the gift", async () => {
    const job = createTestJob();
    const ctx = createContext({
      chats: [{ chatId: "201", topicId: null, giftFilterConfig: "symbol:shield" }],
    });
    const feedHtml = `
      <div class="tgme_widget_message_wrap">
        <time datetime="2026-03-04T10:20:00Z"></time>
        <div class="tgme_widget_message_text js-message_text" dir="auto">
          🎉 GIFT SOLD!<br/><br/>🏷 <a href="https://t.me/nft/SKIPPED">Skipped Gift #1</a>
        </div>
      </div>
    `;
    const nftHtml = `
      <table class="tgme_gift_table">
        <tr><th>Backdrop</th><td>LemonGrass Glow</td></tr>
      </table>
    `;

    mockFetch(async (url) => {
      if (url === "https://t.me/s/testfeed") {
        return htmlResponse(feedHtml);
      }
      if (url === "https://t.me/nft/SKIPPED") {
        return htmlResponse(nftHtml);
      }
      throw new Error(`Unexpected URL in test: ${url}`);
    });

    const events = await job.run(ctx);

    expect(events).toEqual([]);
    expect(getGiftInfoMock).not.toHaveBeenCalled();
  });

  it("logs getGiftInfo failures and still sends the message", async () => {
    const error = new Error("boom");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {
      return;
    });
    getGiftInfoMock.mockRejectedValue(error);
    const job = createTestJob();
    const ctx = createContext({
      chats: [{ chatId: "301", topicId: null, giftFilterConfig: null }],
    });
    const feedHtml = `
      <div class="tgme_widget_message_wrap">
        <time datetime="2026-03-04T10:20:00Z"></time>
        <div class="tgme_widget_message_text js-message_text" dir="auto">
          🎉 GIFT SOLD!<br/><br/>🏷 <a href="https://t.me/nft/FAILED">Failed Gift #1</a>
        </div>
      </div>
    `;

    mockFetch(async (url) => {
      if (url === "https://t.me/s/testfeed") {
        return htmlResponse(feedHtml);
      }
      if (url === "https://t.me/nft/FAILED") {
        return htmlResponse(`<table class="tgme_gift_table"></table>`);
      }
      throw new Error(`Unexpected URL in test: ${url}`);
    });

    const events = await job.run(ctx);

    expect(events).toHaveLength(1);
    expect(events[0]?.message).toBe(
      '🎉 GIFT SOLD!\n\n🏷 <a href="https://t.me/nft/FAILED">Failed Gift #1</a>\n\n<a href="https://xgift.tg/gift-details/FAILED">xGift</a>',
    );
    expect(consoleError).toHaveBeenCalledWith(error);
  });
});
