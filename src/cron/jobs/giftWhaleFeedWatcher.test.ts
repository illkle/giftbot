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
    getJson: vi.fn(async () => options.initialSyncComplete),
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
    listActiveChats: vi.fn(async () => options.chats),
  };
  const giftWhaleFeedSeen: GiftWhaleFeedSeenStore = {
    markSeenIfNew: vi.fn(options.markSeenIfNew),
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
        <a href="https://t.me/nft/OLD">old</a>
      </div>
      <div class="tgme_widget_message_wrap">
        <time datetime="2026-03-04T10:20:00Z"></time>
        <a href="https://t.me/nft/NEW">new</a>
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
        { chatId: "101", giftFilterConfig: null },
        { chatId: "102", giftFilterConfig: "backdrop:lemon" },
        { chatId: "103", giftFilterConfig: "symbol:shield" },
        { chatId: "104", giftFilterConfig: "invalid-filter" },
      ],
      markSeenIfNew,
    });

    const events = await giftWhaleFeedWatcherJob.run(ctx);

    expect(markSeenIfNew).toHaveBeenCalledTimes(2);
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.chatId)).toEqual(["101", "102"]);
    expect(events[0]?.message).toContain("Matched filter: none (chat has no filter)");
    expect(events[1]?.message).toContain("Matched filter: backdrop:lemon");
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("invalid stored filter for chat 104"),
    );
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
        <a href="https://t.me/nft/BAD">bad</a>
      </div>
      <div class="tgme_widget_message_wrap">
        <time datetime="2026-03-04T10:01:00Z"></time>
        <a href="https://t.me/nft/GOOD">good</a>
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
      chats: [{ chatId: "200", giftFilterConfig: null }],
      markSeenIfNew: async () => true,
    });

    const events = await giftWhaleFeedWatcherJob.run(ctx);

    expect(events).toHaveLength(1);
    expect(events[0]?.chatId).toBe("200");
    expect(events[0]?.message).toContain("https://t.me/nft/GOOD");
    expect(ctx.logger.error).toHaveBeenCalledWith(
      expect.stringContaining("failed to process https://t.me/nft/BAD"),
      expect.any(Error),
    );
  });
});
