import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type * as schema from "./schema";

// Both expo-sqlite (app) and better-sqlite3 (tests) are synchronous drivers,
// so transactions take a synchronous callback.
export type AppDb = BaseSQLiteDatabase<"sync", unknown, typeof schema>;
