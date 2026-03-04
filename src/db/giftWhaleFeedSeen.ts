import { and, eq, sql } from "drizzle-orm";
import type { AppDb } from "./client";
import { giftWhaleFeedSeenMessagesTable } from "./schema";

type SeenFeedMessageKey = {
  messageTime: string;
  nftLink: string;
};

type GiftWhaleFeedSeenStore = {
  markSeenIfNew: (key: SeenFeedMessageKey) => Promise<boolean>;
  countSeenMessages: () => Promise<number>;
};

function createGiftWhaleFeedSeenStore(db: AppDb): GiftWhaleFeedSeenStore {
  const markSeenIfNew: GiftWhaleFeedSeenStore["markSeenIfNew"] = async (key) => {
    const existing = db
      .select({ messageTime: giftWhaleFeedSeenMessagesTable.messageTime })
      .from(giftWhaleFeedSeenMessagesTable)
      .where(
        and(
          eq(giftWhaleFeedSeenMessagesTable.messageTime, key.messageTime),
          eq(giftWhaleFeedSeenMessagesTable.nftLink, key.nftLink),
        ),
      )
      .get();

    if (existing) {
      return false;
    }

    const now = Date.now();
    db.insert(giftWhaleFeedSeenMessagesTable)
      .values({
        messageTime: key.messageTime,
        nftLink: key.nftLink,
        firstSeenAt: now,
      })
      .run();

    return true;
  };

  const countSeenMessages: GiftWhaleFeedSeenStore["countSeenMessages"] = async () => {
    const row = db
      .select({ count: sql<number>`count(*)` })
      .from(giftWhaleFeedSeenMessagesTable)
      .get();

    return Number(row?.count ?? 0);
  };

  return {
    markSeenIfNew,
    countSeenMessages,
  };
}

export { createGiftWhaleFeedSeenStore };
export type { GiftWhaleFeedSeenStore, SeenFeedMessageKey };
