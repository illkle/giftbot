import { SALES_CHAT_TYPE } from "../../db/activeChats";
import { createGiftFeedWatcherJob } from "./giftWatcherShared";

const FEED_URL = "https://t.me/s/giftwhalefeed";
const INITIAL_SYNC_STATE_KEY = "giftwhalefeed-watcher:initial-sync-complete";

export const giftWhaleFeedWatcherJob = createGiftFeedWatcherJob({
  name: "giftwhalefeed-watcher",
  feedUrl: FEED_URL,
  initialSyncStateKey: INITIAL_SYNC_STATE_KEY,
  schedule: "*/1 * * * *",
  watchMode: SALES_CHAT_TYPE,
  seenFeedSource: "sales",
});
