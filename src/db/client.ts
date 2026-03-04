import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";

function createDatabase(databasePath: string) {
  const resolvedPath = resolve(databasePath);
  mkdirSync(dirname(resolvedPath), { recursive: true });

  const sqlite = new Database(resolvedPath, { create: true });
  const db = drizzle(sqlite);

  return { db, sqlite, resolvedPath };
}

type AppDb = ReturnType<typeof createDatabase>["db"];

export { createDatabase };
export type { AppDb };
