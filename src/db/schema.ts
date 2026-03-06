import { primaryKey } from "drizzle-orm/sqlite-core";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const cronStateTable = sqliteTable("cron_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

const telegramChatsTable = sqliteTable(
  "telegram_chats",
  {
    chatId: text("chat_id").notNull(),
    topicId: integer("topic_id").notNull().default(0),
    watchMode: text("watch_mode").notNull().default(""),
    giftFilterConfig: text("gift_filter_config"),
    firstSeenAt: integer("first_seen_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.chatId, table.topicId] })],
);

const feedSeenMessagesTable = sqliteTable(
  "giftwhale_feed_seen_messages",
  {
    source: text("source").notNull().default("sales"),
    messageTime: text("message_time").notNull(),
    nftLink: text("nft_link").notNull(),
    firstSeenAt: integer("first_seen_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.source, table.messageTime, table.nftLink] })],
);

export { cronStateTable, feedSeenMessagesTable, telegramChatsTable };
