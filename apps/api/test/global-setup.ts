import pg from "pg";
import { migrateDatabase } from "../src/db/migrate";
import { FAILING_TEXT, TEST_DATABASE_URL } from "./env";

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
    // Test database only: a write of a moment with FAILING_TEXT fails in the
    // database, so tests can make a push fail partway through its writes
    await client.query(`
      create or replace function fail_marked_moment() returns trigger as $$
      begin
        if new.text = '${FAILING_TEXT}' then
          raise exception 'test: failing write';
        end if;
        return new;
      end $$ language plpgsql;
      drop trigger if exists fail_marked_moment on moments;
      create trigger fail_marked_moment before insert or update on moments
        for each row execute function fail_marked_moment();
    `);
  } finally {
    await client.end();
  }
}
