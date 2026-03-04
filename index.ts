import { getConfig } from "./src/config";
import { createCronRunner } from "./src/cron/runner";
import { jobs } from "./src/cron/jobs";
import { createTelegramRuntime } from "./src/telegram/processor";
import { createDatabase } from "./src/db/client";
import { createCronStateStore } from "./src/db/cronStateStore";
import { applyMigrations } from "./src/db/migrate";
import { createActiveChatStore } from "./src/db/activeChats";
import { createGiftWhaleFeedSeenStore } from "./src/db/giftWhaleFeedSeen";

const config = getConfig();
const { db, resolvedPath } = createDatabase(config.databasePath);
applyMigrations(db);
console.info(`[db] ready at ${resolvedPath}`);

const cronStateStore = createCronStateStore(db);
const activeChats = createActiveChatStore(db);
const giftWhaleFeedSeen = createGiftWhaleFeedSeenStore(db);
const telegramRuntime = createTelegramRuntime(config, activeChats, giftWhaleFeedSeen);

const cronRunner = createCronRunner({
  jobs,
  timezone: config.cronTimezone,
  context: {
    state: cronStateStore,
    activeChats,
    giftWhaleFeedSeen,
  },
  onEvents: async (events) => {
    await telegramRuntime.process(events);
  },
});

cronRunner.start();
telegramRuntime.startPolling();

if (config.runJobsOnStartup) {
  await cronRunner.runAllNow();
}
