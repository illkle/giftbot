import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_PATH ?? "./data/giftbot.sqlite";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: databaseUrl,
  },
});
