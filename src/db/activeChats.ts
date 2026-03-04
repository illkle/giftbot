import { eq } from "drizzle-orm";
import type { AppDb } from "./client";
import { telegramChatsTable } from "./schema";

type ActiveChat = {
  chatId: string;
  giftFilterConfig: string | null;
};

type ActiveChatStore = {
  markActive: (chatId: string, giftFilterConfig?: string | null) => Promise<void>;
  markInactive: (chatId: string) => Promise<void>;
  listActiveChats: () => Promise<ActiveChat[]>;
};

function createActiveChatStore(db: AppDb): ActiveChatStore {
  const markActive: ActiveChatStore["markActive"] = async (
    chatId: string,
    giftFilterConfig?: string | null,
  ) => {
    const now = Date.now();

    const conflictSet: Partial<typeof telegramChatsTable.$inferInsert> = {
      isActive: true,
      updatedAt: now,
    };

    if (giftFilterConfig !== undefined) {
      conflictSet.giftFilterConfig = giftFilterConfig;
    }

    db.insert(telegramChatsTable)
      .values({
        chatId,
        isActive: true,
        giftFilterConfig: giftFilterConfig ?? null,
        firstSeenAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: telegramChatsTable.chatId,
        set: conflictSet,
      })
      .run();
  };

  const markInactive: ActiveChatStore["markInactive"] = async (chatId: string) => {
    const now = Date.now();
    db.insert(telegramChatsTable)
      .values({
        chatId,
        isActive: false,
        firstSeenAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: telegramChatsTable.chatId,
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
        giftFilterConfig: telegramChatsTable.giftFilterConfig,
      })
      .from(telegramChatsTable)
      .where(eq(telegramChatsTable.isActive, true))
      .all();

    return rows;
  };

  return {
    markActive,
    markInactive,
    listActiveChats,
  };
}

export { createActiveChatStore };
export type { ActiveChat, ActiveChatStore };
