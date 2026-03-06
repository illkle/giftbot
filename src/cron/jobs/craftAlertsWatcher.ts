import { CRAFTS_CHAT_TYPE } from "../../db/activeChats";
import { createGiftFeedWatcherJob } from "./giftWatcherShared";

const FEED_URL = "https://t.me/s/craftalerts";
const INITIAL_SYNC_STATE_KEY = "craftalerts-watcher:initial-sync-complete";

export const craftAlertsWatcherJob = createGiftFeedWatcherJob({
  name: "craftalerts-watcher",
  feedUrl: FEED_URL,
  initialSyncStateKey: INITIAL_SYNC_STATE_KEY,
  schedule: "*/3 * * * *",
  watchMode: CRAFTS_CHAT_TYPE,
  seenFeedSource: "crafts",
  includeMessage(messageText) {
    return /\bcrafted\b/i.test(messageText);
  },
});
