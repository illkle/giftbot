import type { CronJobDefinition } from "../types";
import { giftWhaleFeedWatcherJob } from "./giftWhaleFeedWatcher";

const jobs: CronJobDefinition[] = [giftWhaleFeedWatcherJob];

export { jobs };
