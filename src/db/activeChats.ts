import { eq } from "drizzle-orm";
import type { AppDb } from "./client";
import { telegramChatsTable } from "./schema";

type ActiveChatStore = {
  markActive: (chatId: string) => Promise<void>;
  markInactive: (chatId: string) => Promise<void>;
  listActiveChatIds: () => Promise<string[]>;
};

function createActiveChatStore(db: AppDb): ActiveChatStore {
  const markActive: ActiveChatStore["markActive"] = async (chatId: string) => {
    const now = Date.now();
    db.insert(telegramChatsTable)
      .values({
        chatId,
        isActive: true,
        firstSeenAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: telegramChatsTable.chatId,
        set: {
          isActive: true,
          updatedAt: now,
        },
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

  const listActiveChatIds: ActiveChatStore["listActiveChatIds"] = async () => {
    const rows = db
      .select({ chatId: telegramChatsTable.chatId })
      .from(telegramChatsTable)
      .where(eq(telegramChatsTable.isActive, true))
      .all();

    return rows.map((row) => row.chatId);
  };

  return {
    markActive,
    markInactive,
    listActiveChatIds,
  };
}

export { createActiveChatStore };
export type { ActiveChatStore };
