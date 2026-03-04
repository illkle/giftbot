import type { BotEvent } from "../events/types";
import type { CronStateStore } from "../db/cronStateStore";
import type { ActiveChatStore } from "../db/activeChats";
import type { GiftWhaleFeedSeenStore } from "../db/giftWhaleFeedSeen";

type CronContext = {
  logger: Pick<Console, "info" | "warn" | "error">;
  state: CronStateStore;
  activeChats: ActiveChatStore;
  giftWhaleFeedSeen: GiftWhaleFeedSeenStore;
};

type CronJobDefinition = {
  name: string;
  schedule: string;
  run: (ctx: CronContext) => Promise<BotEvent[]>;
};

export type { CronContext, CronJobDefinition };
