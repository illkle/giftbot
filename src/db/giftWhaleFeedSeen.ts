import { and, eq } from "drizzle-orm";
import type { AppDb } from "./client";
import { giftWhaleFeedSeenMessagesTable } from "./schema";

type SeenFeedMessageKey = {
  messageTime: string;
  nftLink: string;
};

type GiftWhaleFeedSeenStore = {
  markSeenIfNew: (key: SeenFeedMessageKey) => Promise<boolean>;
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

  return {
    markSeenIfNew,
  };
}

export { createGiftWhaleFeedSeenStore };
export type { GiftWhaleFeedSeenStore, SeenFeedMessageKey };
