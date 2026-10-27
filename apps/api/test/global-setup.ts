import pg from "pg";
import { migrateDatabase } from "../src/db/migrate";
import { TEST_DATABASE_URL } from "./env";

// Once per run: bring the test database up to date and start it empty.
// Tests then use fresh user ids, so files can run in parallel.
export async function setup() {
  await migrateDatabase(TEST_DATABASE_URL);
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      "truncate table moments, moment_photos, user_sync_state",
    );
  } finally {
    await client.end();
  }
}
