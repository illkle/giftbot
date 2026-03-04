import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const cronStateTable = sqliteTable("cron_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export { cronStateTable };
