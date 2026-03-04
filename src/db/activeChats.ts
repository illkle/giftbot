import { eq } from "drizzle-orm";
import type { AppDb } from "./client";
import { telegramChatsTable } from "./schema";

type ActiveChat = {
  chatId: string;
  topicId: number | null;
  giftFilterConfig: string | null;
};

type ActiveChatStore = {
  markActive: (
    chatId: string,
    topicId?: number | null,
    giftFilterConfig?: string | null,
  ) => Promise<void>;
  markInactive: (chatId: string, topicId?: number | null) => Promise<void>;
  listActiveChats: () => Promise<ActiveChat[]>;
};

function createActiveChatStore(db: AppDb): ActiveChatStore {
  const markActive: ActiveChatStore["markActive"] = async (
    chatId: string,
    topicId?: number | null,
    giftFilterConfig?: string | null,
  ) => {
    const now = Date.now();
    const persistedTopicId = topicId ?? 0;

    const conflictSet: Partial<typeof telegramChatsTable.$inferInsert> = {
      isActive: true,
      updatedAt: now,
    };

    if (giftFilterConfig !== undefined) {
      conflictSet.giftFilterConfig = giftFilterConfig;
    }

    console.log("mark active", chatId, topicId);

    db.insert(telegramChatsTable)
      .values({
        chatId,
        topicId: persistedTopicId,
        isActive: true,
        giftFilterConfig: giftFilterConfig ?? null,
        firstSeenAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [telegramChatsTable.chatId, telegramChatsTable.topicId],
        set: conflictSet,
      })
      .run();
  };

  const markInactive: ActiveChatStore["markInactive"] = async (
    chatId: string,
    topicId?: number | null,
  ) => {
    const now = Date.now();
    const persistedTopicId = topicId ?? 0;
    db.insert(telegramChatsTable)
      .values({
        chatId,
        topicId: persistedTopicId,
        isActive: false,
        firstSeenAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [telegramChatsTable.chatId, telegramChatsTable.topicId],
        set: {
          isActive: false,
          updatedAt: now,
        },
      })
      .run();
  };

  const listActiveChats: ActiveChatStore["listActiveChats"] = async () => {
    const rows = db
      .select({
        chatId: telegramChatsTable.chatId,
        topicId: telegramChatsTable.topicId,
        giftFilterConfig: telegramChatsTable.giftFilterConfig,
      })
      .from(telegramChatsTable)
      .where(eq(telegramChatsTable.isActive, true))
      .all();

    return rows.map((row) => ({
      chatId: row.chatId,
      topicId: row.topicId === 0 ? null : row.topicId,
      giftFilterConfig: row.giftFilterConfig,
    }));
  };

  return {
    markActive,
    markInactive,
    listActiveChats,
  };
}

export { createActiveChatStore };
export type { ActiveChat, ActiveChatStore };
