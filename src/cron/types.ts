import type { BotEvent } from "../events/types";
import type { CronStateStore } from "../db/cronStateStore";

type CronContext = {
  logger: Pick<Console, "info" | "warn" | "error">;
  state: CronStateStore;
};

type CronJobDefinition = {
  name: string;
  schedule: string;
  run: (ctx: CronContext) => Promise<BotEvent[]>;
};

export type { CronContext, CronJobDefinition };
