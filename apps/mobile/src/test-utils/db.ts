import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { insertMoment, type Moment } from "@/db/moments-store";
import * as schema from "@/db/schema";
import type { AppDb } from "@/db/types";
import type { MomentKind } from "@/kinds";

// expo-sqlite can't run under Jest. better-sqlite3 is synchronous like it,
// and runs the app's own generated migrations.
export function createTestDb(): AppDb {
  const db = drizzle(new Database(":memory:"), { schema });
  migrate(db, { migrationsFolder: path.join(__dirname, "../../drizzle") });
  return db;
}

// Keeps moments as if they had been kept at their createdAt
export function seedMoments(
  db: AppDb,
  seeds: {
    text: string;
    photos?: string[];
    kind?: MomentKind;
    createdAt: number;
  }[],
): Moment[] {
  return seeds.map(({ createdAt, photos = [], ...rest }) =>
    insertMoment(
      db,
      { ...rest, photos },
      { newId: randomUUID, now: () => createdAt },
    ),
  );
}
