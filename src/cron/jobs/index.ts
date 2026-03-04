import type { CronJobDefinition } from "../types";
import { btcSpotWatcherJob } from "./btcSpotWatcher";

const jobs: CronJobDefinition[] = [btcSpotWatcherJob];

export { jobs };
