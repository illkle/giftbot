import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BotEvent } from "../events/types";
import type { CronJobDefinition } from "./types";

const { scheduleMock, scheduledCallbacks, scheduledTasks } = vi.hoisted(() => {
  const callbacks: Array<() => Promise<void>> = [];
  const tasks: Array<{ stop: ReturnType<typeof vi.fn> }> = [];
  const schedule = vi.fn((_: string, callback: () => Promise<void>) => {
    callbacks.push(callback);
    const task = { stop: vi.fn() };
    tasks.push(task);
    return task;
  });

  return {
    scheduleMock: schedule,
    scheduledCallbacks: callbacks,
    scheduledTasks: tasks,
  };
});

vi.mock("node-cron", () => ({
  default: {
    schedule: scheduleMock,
  },
}));

function makeEvent(message: string): BotEvent {
  return {
    type: "info",
    source: "test-job",
    message,
  };
}

describe("createCronRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scheduledCallbacks.length = 0;
    scheduledTasks.length = 0;
  });

  it("runs all jobs immediately and forwards only non-empty event batches", async () => {
    const { createCronRunner } = await import("./runner");
    const eventsFromSecond = [makeEvent("from-second")];
    const runFirst = vi.fn(async () => []);
    const runSecond = vi.fn(async () => eventsFromSecond);
    const onEvents = vi.fn(async () => {
      return;
    });

    const runner = createCronRunner({
      jobs: [
        { name: "first", schedule: "* * * * *", run: runFirst },
        { name: "second", schedule: "* * * * *", run: runSecond },
      ],
      timezone: "UTC",
      onEvents,
      context: {
        state: {} as any,
        activeChats: {} as any,
        giftWhaleFeedSeen: {} as any,
      },
    });

    await runner.runAllNow();

    expect(runFirst).toHaveBeenCalledTimes(1);
    expect(runSecond).toHaveBeenCalledTimes(1);
    expect(onEvents).toHaveBeenCalledTimes(1);
    expect(onEvents).toHaveBeenCalledWith(eventsFromSecond);
  });

  it("schedules all jobs with the provided timezone and executes callbacks", async () => {
    const { createCronRunner } = await import("./runner");
    const onEvents = vi.fn(async () => {
      return;
    });
    const jobRun = vi.fn(async () => [makeEvent("scheduled")]);
    const jobs: CronJobDefinition[] = [{ name: "watcher", schedule: "*/5 * * * *", run: jobRun }];

    const runner = createCronRunner({
      jobs,
      timezone: "Europe/Moscow",
      onEvents,
      context: {
        state: {} as any,
        activeChats: {} as any,
        giftWhaleFeedSeen: {} as any,
      },
    });

    runner.start();

    expect(scheduleMock).toHaveBeenCalledWith(
      "*/5 * * * *",
      expect.any(Function),
      expect.objectContaining({ timezone: "Europe/Moscow" }),
    );

    await scheduledCallbacks[0]?.();
    expect(jobRun).toHaveBeenCalledTimes(1);
    expect(onEvents).toHaveBeenCalledWith([makeEvent("scheduled")]);
  });

  it("stops all scheduled tasks", async () => {
    const { createCronRunner } = await import("./runner");
    const runner = createCronRunner({
      jobs: [
        { name: "a", schedule: "* * * * *", run: vi.fn(async () => []) },
        { name: "b", schedule: "*/2 * * * *", run: vi.fn(async () => []) },
      ],
      timezone: "UTC",
      onEvents: vi.fn(async () => {
        return;
      }),
      context: {
        state: {} as any,
        activeChats: {} as any,
        giftWhaleFeedSeen: {} as any,
      },
    });

    runner.start();
    runner.stop();

    expect(scheduledTasks).toHaveLength(2);
    expect(scheduledTasks[0]?.stop).toHaveBeenCalledTimes(1);
    expect(scheduledTasks[1]?.stop).toHaveBeenCalledTimes(1);
  });

  it("skips overlapping runs of the same job", async () => {
    const { createCronRunner } = await import("./runner");

    let resolveRun!: () => void;
    const inFlight = new Promise<BotEvent[]>((resolve) => {
      resolveRun = () => resolve([]);
    });
    const run = vi.fn(() => inFlight);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      return;
    });

    const runner = createCronRunner({
      jobs: [{ name: "slow", schedule: "* * * * *", run }],
      timezone: "UTC",
      onEvents: vi.fn(async () => {
        return;
      }),
      context: {
        state: {} as any,
        activeChats: {} as any,
        giftWhaleFeedSeen: {} as any,
      },
    });

    runner.start();

    const tick = scheduledCallbacks[0];
    const firstRun = tick?.();
    const secondRun = tick?.();

    expect(run).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[cron:slow] skipped: previous run still in progress"),
    );

    resolveRun();
    await firstRun;
    await secondRun;
  });
});
