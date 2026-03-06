import type { BotEvent } from "../events/types";
import type { CronStateStore } from "../db/cronStateStore";
import type { ActiveChatStore } from "../db/activeChats";
import type { FeedSeenStore } from "../db/feedSeen";

type CronContext = {
  logger: Pick<Console, "info" | "warn" | "error">;
  state: CronStateStore;
  activeChats: ActiveChatStore;
  feedSeen: FeedSeenStore;
};

type CronJobDefinition = {
  name: string;
  schedule: string;
  run: (ctx: CronContext) => Promise<BotEvent[]>;
};

export type { CronContext, CronJobDefinition };
