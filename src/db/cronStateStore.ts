import { eq } from "drizzle-orm";
import type { AppDb } from "./client";
import { cronStateTable } from "./schema";

type CronStateStore = {
  getJson: <T>(key: string) => Promise<T | undefined>;
  setJson: <T>(key: string, value: T) => Promise<void>;
  getNumber: (key: string) => Promise<number | undefined>;
  setNumber: (key: string, value: number) => Promise<void>;
};

function createCronStateStore(db: AppDb): CronStateStore {
  const getJson: CronStateStore["getJson"] = async <T>(key: string) => {
    const row = db
      .select({ value: cronStateTable.value })
      .from(cronStateTable)
      .where(eq(cronStateTable.key, key))
      .get();

    if (!row) {
      return undefined;
    }

    return JSON.parse(row.value) as T;
  };

  const setJson: CronStateStore["setJson"] = async <T>(key: string, value: T) => {
    const now = Date.now();
    const encodedValue = JSON.stringify(value);
    db.insert(cronStateTable)
      .values({
        key,
        value: encodedValue,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: cronStateTable.key,
        set: {
          value: encodedValue,
          updatedAt: now,
        },
      })
      .run();
  };

  const getNumber: CronStateStore["getNumber"] = async (key: string) => {
    const value = await getJson<unknown>(key);
    if (typeof value !== "number" || Number.isNaN(value)) {
      return undefined;
    }
    return value;
  };

  const setNumber: CronStateStore["setNumber"] = async (key: string, value: number) => {
    await setJson<number>(key, value);
  };

  return {
    getJson,
    setJson,
    getNumber,
    setNumber,
  };
}

export { createCronStateStore };
export type { CronStateStore };
