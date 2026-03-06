import { and, eq, sql } from "drizzle-orm";
import type { AppDb } from "./client";
import { feedSeenMessagesTable } from "./schema";

type SeenFeedMessageKey = {
  source: string;
  messageTime: string;
  nftLink: string;
};

type FeedSeenStore = {
  markSeenIfNew: (key: SeenFeedMessageKey) => Promise<boolean>;
  countSeenMessages: () => Promise<number>;
};

function createFeedSeenStore(db: AppDb): FeedSeenStore {
  const markSeenIfNew: FeedSeenStore["markSeenIfNew"] = async (key) => {
    const existing = db
      .select({ source: feedSeenMessagesTable.source })
      .from(feedSeenMessagesTable)
      .where(
        and(
          eq(feedSeenMessagesTable.source, key.source),
          eq(feedSeenMessagesTable.messageTime, key.messageTime),
          eq(feedSeenMessagesTable.nftLink, key.nftLink),
        ),
      )
      .get();

    if (existing) {
      return false;
    }

    const now = Date.now();
    db.insert(feedSeenMessagesTable)
      .values({
        source: key.source,
        messageTime: key.messageTime,
        nftLink: key.nftLink,
        firstSeenAt: now,
      })
      .run();

    return true;
  };

  const countSeenMessages: FeedSeenStore["countSeenMessages"] = async () => {
    const row = db
      .select({ count: sql<number>`count(*)` })
      .from(feedSeenMessagesTable)
      .get();

    return Number(row?.count ?? 0);
  };

  return {
    markSeenIfNew,
    countSeenMessages,
  };
}

export { createFeedSeenStore };
export type { FeedSeenStore, SeenFeedMessageKey };
