import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import pg from "pg";

const migrationsFolder = path.join(import.meta.dirname, "../../drizzle");

// Applies the checked-in migrations: for local development, tests and deploys
export async function migrateDatabase(url: string) {
  const pool = new pg.Pool({ connectionString: url });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder });
  } finally {
    await pool.end();
  }
}
