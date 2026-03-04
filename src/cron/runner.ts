import cron from "node-cron";
import type { ScheduledTask } from "node-cron";
import type { BotEvent } from "../events/types";
import type { CronContext, CronJobDefinition } from "./types";

type CronRunnerOptions = {
  jobs: CronJobDefinition[];
  onEvents: (events: BotEvent[]) => Promise<void>;
  timezone: string;
  context: Omit<CronContext, "logger">;
};

function createCronRunner(options: CronRunnerOptions) {
  const { jobs, onEvents, timezone, context } = options;
  const logger = console;
  const tasks: ScheduledTask[] = [];
  const inFlight = new Set<string>();
  const ctx: CronContext = { logger, ...context };

  const runJob = async (job: CronJobDefinition): Promise<void> => {
    if (inFlight.has(job.name)) {
      logger.warn(`[cron:${job.name}] skipped: previous run still in progress`);
      return;
    }

    inFlight.add(job.name);
    logger.info(`[cron:${job.name}] started`);

    try {
      const events = await job.run(ctx);
      if (events.length > 0) {
        await onEvents(events);
      }
      logger.info(`[cron:${job.name}] finished with ${events.length} event(s)`);
    } catch (error) {
      logger.error(`[cron:${job.name}] failed`, error);
    } finally {
      inFlight.delete(job.name);
    }
  };

  return {
    start() {
      for (const job of jobs) {
        const task = cron.schedule(
          job.schedule,
          async () => {
            await runJob(job);
          },
          { timezone },
        );
        tasks.push(task);
        logger.info(`[cron:${job.name}] scheduled: "${job.schedule}" (${timezone})`);
      }
    },
    async runAllNow() {
      for (const job of jobs) {
        await runJob(job);
      }
    },
    stop() {
      for (const task of tasks) {
        task.stop();
      }
      logger.info(`Stopped ${tasks.length} cron task(s)`);
    },
  };
}

export { createCronRunner };
