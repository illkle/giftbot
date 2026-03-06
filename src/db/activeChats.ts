import { asc, eq } from "drizzle-orm";
import type { AppDb } from "./client";
import { telegramChatsTable } from "./schema";

const SALES_CHAT_TYPE = "sales";

type ActiveChat = {
  chatId: string;
  topicId: number | null;
  giftFilterConfig: string | null;
};

type StoredChat = ActiveChat & {
  watchMode: string;
};

type ActiveChatStore = {
  markActive: (
    chatId: string,
    topicId?: number | null,
    giftFilterConfig?: string | null,
  ) => Promise<void>;
  markInactive: (chatId: string, topicId?: number | null) => Promise<void>;
  listActiveChats: (chatType: string) => Promise<ActiveChat[]>;
  listAllChats: () => Promise<StoredChat[]>;
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
      watchMode: SALES_CHAT_TYPE,
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
        watchMode: SALES_CHAT_TYPE,
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
        watchMode: "",
        firstSeenAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [telegramChatsTable.chatId, telegramChatsTable.topicId],
        set: {
          watchMode: "",
          updatedAt: now,
        },
      })
      .run();
  };

  const listActiveChats: ActiveChatStore["listActiveChats"] = async (chatType: string) => {
    const rows = db
      .select({
        chatId: telegramChatsTable.chatId,
        topicId: telegramChatsTable.topicId,
        giftFilterConfig: telegramChatsTable.giftFilterConfig,
      })
      .from(telegramChatsTable)
      .where(eq(telegramChatsTable.watchMode, chatType))
      .all();

    return rows.map((row) => ({
      chatId: row.chatId,
      topicId: row.topicId === 0 ? null : row.topicId,
      giftFilterConfig: row.giftFilterConfig,
    }));
  };

  const listAllChats: ActiveChatStore["listAllChats"] = async () => {
    const rows = db
      .select({
        chatId: telegramChatsTable.chatId,
        topicId: telegramChatsTable.topicId,
        watchMode: telegramChatsTable.watchMode,
        giftFilterConfig: telegramChatsTable.giftFilterConfig,
      })
      .from(telegramChatsTable)
      .orderBy(asc(telegramChatsTable.chatId), asc(telegramChatsTable.topicId))
      .all();

    return rows.map((row) => ({
      chatId: row.chatId,
      topicId: row.topicId === 0 ? null : row.topicId,
      watchMode: row.watchMode,
      giftFilterConfig: row.giftFilterConfig,
    }));
  };

  return {
    markActive,
    markInactive,
    listActiveChats,
    listAllChats,
  };
}

export { createActiveChatStore };
export { SALES_CHAT_TYPE };
export type { ActiveChat, ActiveChatStore, StoredChat };
