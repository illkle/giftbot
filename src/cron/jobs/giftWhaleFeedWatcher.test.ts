import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActiveChatStore } from "../../db/activeChats";
import type { CronStateStore } from "../../db/cronStateStore";
import type { GiftWhaleFeedSeenStore } from "../../db/giftWhaleFeedSeen";
import { giftWhaleFeedWatcherJob } from "./giftWhaleFeedWatcher";

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
  markSeenIfNew: GiftWhaleFeedSeenStore["markSeenIfNew"];
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
  };
  const giftWhaleFeedSeen: GiftWhaleFeedSeenStore = {
    markSeenIfNew: vi.fn(options.markSeenIfNew),
    countSeenMessages: vi.fn(async () => 0),
  };

  return {
    logger,
    state,
    activeChats,
    giftWhaleFeedSeen,
  };
}

describe("giftWhaleFeedWatcherJob", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env.CRON_TIMEZONE;
  });

  it("performs initial sync and emits no notifications", async () => {
    const feedHtml = `
      <div class="tgme_widget_message_wrap">
        <time datetime="2026-03-04T10:00:00Z"></time>
        <a href="https://t.me/nft/A1">one</a>
        <a href="https://t.me/nft/A1">duplicate in same message</a>
      </div>
      <div class="tgme_widget_message_wrap">
        <time datetime="2026-03-04T10:10:00Z"></time>
        <a href="/nft/B2">two</a>
        <a href="https://example.com/nft/ignored">ignored host</a>
      </div>
    `;

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => htmlResponse(feedHtml)),
    );

    const setJson = vi.fn(async () => {
      return;
    });
    const ctx = createContext({
      initialSyncComplete: undefined,
      chats: [],
      setJson,
      markSeenIfNew: async () => true,
    });

    const events = await giftWhaleFeedWatcherJob.run(ctx);

    expect(events).toEqual([]);
    expect(ctx.giftWhaleFeedSeen.markSeenIfNew).toHaveBeenCalledTimes(2);
    expect(ctx.activeChats.listActiveChats).not.toHaveBeenCalled();
    expect(setJson).toHaveBeenCalledWith("giftwhalefeed-watcher:initial-sync-complete", true);
  });

  it("routes notifications only to chats eligible by filter state", async () => {
    const feedHtml = `
      <div class="tgme_widget_message_wrap">
        <time datetime="2026-03-04T10:00:00Z"></time>
        <div class="tgme_widget_message_text js-message_text" dir="auto">
          🎉 GIFT SOLD!<br/><br/>🏷 <a href="https://t.me/nft/OLD">Old Gift #1</a><br/>└ Sold on <a href="https://t.me/mrkt/app?startapp=123">MRKT</a>
        </div>
      </div>
      <div class="tgme_widget_message_wrap">
        <time datetime="2026-03-04T10:20:00Z"></time>
        <div class="tgme_widget_message_text js-message_text" dir="auto">
          🎉 GIFT SOLD!<br/><br/>🏷 <a href="https://t.me/nft/NEW">Westside Sign #2</a><br/>├ Model: <code>Bow Wizzle</code><br/>└ Sold on <a href="https://t.me/mrkt/app?startapp=123">MRKT</a>
        </div>
      </div>
    `;
    const nftHtml = `
      <div class="tgme_gift_preview"><svg><text>Westside Sign</text></svg></div>
      <table class="tgme_gift_table">
        <tr><th>Backdrop</th><td>LemonGrass Glow</td></tr>
        <tr><th>Symbol</th><td>Star</td></tr>
      </table>
    `;

    const seenKeys = new Set<string>(["2026-03-04T10:00:00Z::https://t.me/nft/OLD"]);
    const markSeenIfNew = vi.fn(async (key: { messageTime: string; nftLink: string }) => {
      const seenKey = `${key.messageTime}::${key.nftLink}`;
      if (seenKeys.has(seenKey)) {
        return false;
      }
      seenKeys.add(seenKey);
      return true;
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url === "https://t.me/s/giftwhalefeed") {
          return htmlResponse(feedHtml);
        }
        if (url === "https://t.me/nft/NEW") {
          return htmlResponse(nftHtml);
        }
        throw new Error(`Unexpected URL in test: ${url}`);
      }),
    );

    const ctx = createContext({
      initialSyncComplete: true,
      chats: [
        { chatId: "101", topicId: null, giftFilterConfig: null },
        { chatId: "102", topicId: 500, giftFilterConfig: "backdrop:lemon" },
        { chatId: "103", topicId: null, giftFilterConfig: "symbol:shield" },
        { chatId: "104", topicId: null, giftFilterConfig: "invalid-filter" },
      ],
      markSeenIfNew,
    });

    const events = await giftWhaleFeedWatcherJob.run(ctx);

    expect(markSeenIfNew).toHaveBeenCalledTimes(2);
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.chatId)).toEqual(["101", "102"]);
    expect(events.map((event) => event.topicId)).toEqual([undefined, 500]);
    expect(events[0]?.message).not.toMatch(/\n\n#[A-Za-z_]+$/);
    expect(events[1]?.message).toContain("#backdrop_lemon");
    expect(events[0]?.message).toContain("🎉 GIFT SOLD!");
    expect(events[0]?.message).toContain('<a href="https://t.me/nft/NEW">Westside Sign #2</a>');
    expect(events[1]?.message).toContain(
      '└ Sold on <a href="https://t.me/mrkt/app?startapp=123">MRKT</a>',
    );
    expect(events[1]?.message?.endsWith("#backdrop_lemon")).toBe(true);
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("invalid stored filter for chat 104"),
    );
  });

  it("appends a searchable hashtag when a chat filter matches", async () => {
    const feedHtml = `
      <div class="tgme_widget_message_wrap">
        <time datetime="2026-03-04T10:20:00Z"></time>
        <div class="tgme_widget_message_text js-message_text" dir="auto">
          🎉 GIFT SOLD!<br/><br/>🏷 <a href="https://t.me/nft/FILTERED">Filtered Gift #1</a><br/>└ Sold on <a href="https://t.me/mrkt/app?startapp=123">MRKT</a>
        </div>
      </div>
    `;
    const nftHtml = `
      <table class="tgme_gift_table">
        <tr><th>Backdrop</th><td>LemonGrass Glow</td></tr>
      </table>
    `;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url === "https://t.me/s/giftwhalefeed") {
          return htmlResponse(feedHtml);
        }
        if (url === "https://t.me/nft/FILTERED") {
          return htmlResponse(nftHtml);
        }
        throw new Error(`Unexpected URL in test: ${url}`);
      }),
    );

    const ctx = createContext({
      initialSyncComplete: true,
      chats: [{ chatId: "501", topicId: null, giftFilterConfig: "backdrop:lemon" }],
      markSeenIfNew: async () => true,
    });

    const events = await giftWhaleFeedWatcherJob.run(ctx);

    expect(events).toHaveLength(1);
    expect(events[0]?.chatId).toBe("501");
    expect(events[0]?.message).toContain("#backdrop_lemon");
    expect(events[0]?.message).toContain(
      '<a href="https://t.me/nft/FILTERED">Filtered Gift #1</a>',
    );
    expect(events[0]?.message?.endsWith("#backdrop_lemon")).toBe(true);
  });

  it("sanitizes filter hashtags for Telegram search", async () => {
    const feedHtml = `
      <div class="tgme_widget_message_wrap">
        <time datetime="2026-03-04T10:20:00Z"></time>
        <div class="tgme_widget_message_text js-message_text" dir="auto">
          🎉 GIFT SOLD!<br/><br/>🏷 <a href="https://t.me/nft/SANITIZED">Filtered Gift #2</a><br/>└ Sold on <a href="https://t.me/mrkt/app?startapp=123">MRKT</a>
        </div>
      </div>
    `;
    const nftHtml = `
      <table class="tgme_gift_table">
        <tr><th>Backdrop</th><td>Midnight Blue</td></tr>
      </table>
    `;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url === "https://t.me/s/giftwhalefeed") {
          return htmlResponse(feedHtml);
        }
        if (url === "https://t.me/nft/SANITIZED") {
          return htmlResponse(nftHtml);
        }
        throw new Error(`Unexpected URL in test: ${url}`);
      }),
    );

    const ctx = createContext({
      initialSyncComplete: true,
      chats: [{ chatId: "502", topicId: null, giftFilterConfig: "backdrop:midnight blue" }],
      markSeenIfNew: async () => true,
    });

    const events = await giftWhaleFeedWatcherJob.run(ctx);

    expect(events).toHaveLength(1);
    expect(events[0]?.message?.endsWith("#backdrop_midnight_blue")).toBe(true);
  });

  it("keeps topic filters isolated within the same chat", async () => {
    const feedHtml = `
      <div class="tgme_widget_message_wrap">
        <time datetime="2026-03-04T10:20:00Z"></time>
        <div class="tgme_widget_message_text js-message_text" dir="auto">
          🎉 GIFT SOLD!<br/><br/>🏷 <a href="https://t.me/nft/TOPIC">Topic Gift #1</a><br/>└ Sold on <a href="https://t.me/mrkt/app?startapp=123">MRKT</a>
        </div>
      </div>
    `;
    const nftHtml = `
      <table class="tgme_gift_table">
        <tr><th>Backdrop</th><td>LemonGrass Glow</td></tr>
        <tr><th>Symbol</th><td>Star</td></tr>
      </table>
    `;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url === "https://t.me/s/giftwhalefeed") {
          return htmlResponse(feedHtml);
        }
        if (url === "https://t.me/nft/TOPIC") {
          return htmlResponse(nftHtml);
        }
        throw new Error(`Unexpected URL in test: ${url}`);
      }),
    );

    const ctx = createContext({
      initialSyncComplete: true,
      chats: [
        { chatId: "500", topicId: 11, giftFilterConfig: null },
        { chatId: "500", topicId: 12, giftFilterConfig: "symbol:shield" },
        { chatId: "500", topicId: 13, giftFilterConfig: "backdrop:lemon" },
      ],
      markSeenIfNew: async () => true,
    });

    const events = await giftWhaleFeedWatcherJob.run(ctx);

    expect(events).toHaveLength(2);
    expect(events.map((event) => event.topicId)).toEqual([11, 13]);
  });

  it("returns a structured error event when feed fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => htmlResponse("upstream unavailable", 500)),
    );

    const ctx = createContext({
      initialSyncComplete: true,
      chats: [],
      markSeenIfNew: async () => true,
    });

    const events = await giftWhaleFeedWatcherJob.run(ctx);

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("external_api_error");
    expect(events[0]?.source).toBe("giftwhalefeed-watcher");
    expect(events[0]?.message).toContain("HTTP 500");
  });

  it("continues processing remaining unseen links after one NFT fetch failure", async () => {
    const feedHtml = `
      <div class="tgme_widget_message_wrap">
        <time datetime="2026-03-04T10:00:00Z"></time>
        <div class="tgme_widget_message_text js-message_text" dir="auto">
          🎉 GIFT SOLD!<br/><br/>🏷 <a href="https://t.me/nft/BAD">Bad Gift #1</a>
        </div>
      </div>
      <div class="tgme_widget_message_wrap">
        <time datetime="2026-03-04T10:01:00Z"></time>
        <div class="tgme_widget_message_text js-message_text" dir="auto">
          🎉 GIFT SOLD!<br/><br/>🏷 <a href="https://t.me/nft/GOOD">Good Gift #1</a>
        </div>
      </div>
    `;
    const goodNftHtml = `
      <table class="tgme_gift_table">
        <tr><th>Backdrop</th><td>Orange Sky</td></tr>
      </table>
    `;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url === "https://t.me/s/giftwhalefeed") {
          return htmlResponse(feedHtml);
        }
        if (url === "https://t.me/nft/BAD") {
          return htmlResponse("bad", 500);
        }
        if (url === "https://t.me/nft/GOOD") {
          return htmlResponse(goodNftHtml);
        }
        throw new Error(`Unexpected URL in test: ${url}`);
      }),
    );

    const ctx = createContext({
      initialSyncComplete: true,
      chats: [{ chatId: "200", topicId: null, giftFilterConfig: null }],
      markSeenIfNew: async () => true,
    });

    const events = await giftWhaleFeedWatcherJob.run(ctx);

    expect(events).toHaveLength(1);
    expect(events[0]?.chatId).toBe("200");
    expect(events[0]?.message).not.toMatch(/\n\n#[A-Za-z_]+$/);
    expect(events[0]?.message).toContain('<a href="https://t.me/nft/GOOD">Good Gift #1</a>');
    expect(ctx.logger.error).toHaveBeenCalledWith(
      expect.stringContaining("failed to process https://t.me/nft/BAD"),
      expect.any(Error),
    );
  });

  it("parses saved feed fixture and keeps only NFT + MRKT links", async () => {
    const feedHtml = readFileSync(
      new URL("./fixtures/giftwhalefeed.page.example.html", import.meta.url),
      "utf8",
    );
    const allowedNftLinks = new Set([
      "https://t.me/nft/HeartLocket-450",
      "https://t.me/nft/HeartLocket-1522",
    ]);
    const seenKeys = new Set<string>();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url === "https://t.me/s/giftwhalefeed") {
          return htmlResponse(feedHtml);
        }

        if (allowedNftLinks.has(url)) {
          return htmlResponse(`<table class="tgme_gift_table"></table>`);
        }

        throw new Error(`Unexpected URL in test: ${url}`);
      }),
    );

    const ctx = createContext({
      initialSyncComplete: true,
      chats: [{ chatId: "300", topicId: null, giftFilterConfig: null }],
      markSeenIfNew: async (key) => {
        const uniqueKey = `${key.messageTime}::${key.nftLink}`;
        if (seenKeys.has(uniqueKey)) {
          return false;
        }
        seenKeys.add(uniqueKey);

        return allowedNftLinks.has(key.nftLink);
      },
    });

    const events = await giftWhaleFeedWatcherJob.run(ctx);

    expect(events).toHaveLength(2);

    const mrktMessage = events.find((event) =>
      event.message.includes("Heart Locket #450"),
    )?.message;
    const portalsMessage = events.find((event) =>
      event.message.includes("Heart Locket #1522"),
    )?.message;

    expect(mrktMessage).toBe(
      [
        "🎉 GIFT SOLD!",
        "",
        '🏷 <a href="https://t.me/nft/HeartLocket-450">Heart Locket #450</a>',
        "├ Model: Toy Joy",
        "├ Price: 1738.99 TON (~$2254.25)",
        '└ Sold on <a href="https://t.me/mrkt/app?startapp=363826839">MRKT</a>',
      ].join("\n"),
    );

    expect(portalsMessage).not.toMatch(/\n\n#[A-Za-z_]+$/);
    expect(portalsMessage).toContain(
      '🏷 <a href="https://t.me/nft/HeartLocket-1522">Heart Locket #1522</a>',
    );
    expect(portalsMessage).toContain("└ Sold on Portals");
    expect(portalsMessage).not.toContain("https://t.me/portals/market");
  });
});
