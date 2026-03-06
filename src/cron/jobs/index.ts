import type { CronJobDefinition } from "../types";
import { craftAlertsWatcherJob } from "./craftAlertsWatcher";
import { giftWhaleFeedWatcherJob } from "./giftWhaleFeedWatcher";

const jobs: CronJobDefinition[] = [giftWhaleFeedWatcherJob, craftAlertsWatcherJob];

export { jobs };
