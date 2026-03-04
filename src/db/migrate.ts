import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { AppDb } from "./client";

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = resolve(CURRENT_DIR, "../../drizzle");

function applyMigrations(db: AppDb): void {
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

export { applyMigrations, MIGRATIONS_FOLDER };
