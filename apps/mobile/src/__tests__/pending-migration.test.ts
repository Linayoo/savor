import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import {
  mkdtempSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as schema from "@/db/schema";

const migrationsFolder = path.join(__dirname, "../../drizzle");

// A migrations folder that stops after the first migration, to stand in for
// a phone that hasn't updated yet
function firstMigrationOnly() {
  const dir = mkdtempSync(path.join(tmpdir(), "savor-migrations-"));
  mkdirSync(path.join(dir, "meta"));
  const journal = JSON.parse(
    readFileSync(path.join(migrationsFolder, "meta/_journal.json"), "utf8"),
  );
  const [first] = journal.entries;
  writeFileSync(
    path.join(dir, "meta/_journal.json"),
    JSON.stringify({ ...journal, entries: [first] }),
  );
  copyFileSync(
    path.join(migrationsFolder, `${first.tag}.sql`),
    path.join(dir, `${first.tag}.sql`),
  );
  return dir;
}

describe("the pending migration", () => {
  it("marks moments kept before it as pending, so they're pushed on first sign-in", () => {
    const db = drizzle(new Database(":memory:"), { schema });
    migrate(db, { migrationsFolder: firstMigrationOnly() });
    db.$client
      .prepare(
        "insert into moments (id, text, created_at, updated_at) values (?, ?, ?, ?)",
      )
      .run("6f1c1d0e-1c1a-4f6e-9a51-3f3f0b0e2a11", "Old moment", 1, 1);

    migrate(db, { migrationsFolder });

    expect(db.select().from(schema.moments).all()[0].pending).toBe(1);
  });
});
