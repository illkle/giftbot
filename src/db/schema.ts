import { primaryKey } from "drizzle-orm/sqlite-core";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const cronStateTable = sqliteTable("cron_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

const telegramChatsTable = sqliteTable("telegram_chats", {
  chatId: text("chat_id").primaryKey(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  giftFilterConfig: text("gift_filter_config"),
  firstSeenAt: integer("first_seen_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

const giftWhaleFeedSeenMessagesTable = sqliteTable(
  "giftwhale_feed_seen_messages",
  {
    messageTime: text("message_time").notNull(),
    nftLink: text("nft_link").notNull(),
    firstSeenAt: integer("first_seen_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.messageTime, table.nftLink] })],
);

export { cronStateTable, telegramChatsTable, giftWhaleFeedSeenMessagesTable };
