import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import pg from "pg";

const migrationsFolder = path.join(import.meta.dirname, "../../drizzle");

// Applies the checked-in migrations; used for local development and tests
export async function migrateDatabase(url: string) {
  const pool = new pg.Pool({ connectionString: url });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder });
  } finally {
    await pool.end();
  }
}
