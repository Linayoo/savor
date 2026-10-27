import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import * as schema from "@/db/schema";
import type { AppDb } from "@/db/types";

// expo-sqlite can't run under Jest. better-sqlite3 is synchronous like it,
// and runs the app's own generated migrations.
export function createTestDb(): AppDb {
  const db = drizzle(new Database(":memory:"), { schema });
  migrate(db, { migrationsFolder: path.join(__dirname, "../../drizzle") });
  return db;
}
