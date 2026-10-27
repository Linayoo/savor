import { Pool as NeonPool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "./schema";

// Both drivers support interactive transactions, so code that takes a Db
// doesn't know which one it runs on (ADR 0003)
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

// node-postgres locally and in CI, Neon's WebSocket driver in production
export type Driver = "node-postgres" | "neon";

export function createDb(
  url: string,
  driver: Driver = "node-postgres",
): { db: Db; close: () => Promise<void> } {
  if (driver === "neon") {
    const pool = new NeonPool({ connectionString: url });
    return {
      db: drizzleNeon({ client: pool, schema }),
      close: () => pool.end(),
    };
  }
  const pool = new pg.Pool({ connectionString: url });
  return {
    db: drizzleNodePg({ client: pool, schema }),
    close: () => pool.end(),
  };
}
