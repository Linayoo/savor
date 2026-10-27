import { sql } from "drizzle-orm";
import { createTestDb } from "@/test-utils/db";

describe("createTestDb", () => {
  it("applies the app's migrations to an in-memory database", () => {
    const db = createTestDb();

    const tables = db
      .all<{ name: string }>(
        sql`select name from sqlite_master where type = 'table' and name not like '%drizzle%' and name not like 'sqlite_%' order by name`,
      )
      .map((t) => t.name);

    expect(tables).toEqual(["app_meta", "moment_photos", "moments"]);
  });

  it("gives every test its own empty database", () => {
    const db = createTestDb();

    expect(db.all(sql`select * from moments`)).toEqual([]);
  });
});
