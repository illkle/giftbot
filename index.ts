import { getConfig } from "./src/config";
import { createCronRunner } from "./src/cron/runner";
import { jobs } from "./src/cron/jobs";
import { createTelegramEventProcessor } from "./src/telegram/processor";
import { createDatabase } from "./src/db/client";
import { createCronStateStore } from "./src/db/cronStateStore";
import { applyMigrations } from "./src/db/migrate";

const config = getConfig();
const { db, resolvedPath } = createDatabase(config.databasePath);
applyMigrations(db);
console.info(`[db] ready at ${resolvedPath}`);

const cronStateStore = createCronStateStore(db);
const eventProcessor = createTelegramEventProcessor(config);

const cronRunner = createCronRunner({
  jobs,
  timezone: config.cronTimezone,
  context: {
    state: cronStateStore,
  },
  onEvents: async (events) => {
    await eventProcessor.process(events);
  },
});

cronRunner.start();

if (config.runJobsOnStartup) {
  await cronRunner.runAllNow();
}
