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

// A migrations folder that stops after the first `count` migrations, to stand
// in for a phone that hasn't updated yet
function migrationsUpTo(count: number) {
  const dir = mkdtempSync(path.join(tmpdir(), "savor-migrations-"));
  mkdirSync(path.join(dir, "meta"));
  const journal = JSON.parse(
    readFileSync(path.join(migrationsFolder, "meta/_journal.json"), "utf8"),
  );
  const entries: { tag: string }[] = journal.entries.slice(0, count);
  writeFileSync(
    path.join(dir, "meta/_journal.json"),
    JSON.stringify({ ...journal, entries }),
  );
  for (const { tag } of entries) {
    copyFileSync(
      path.join(migrationsFolder, `${tag}.sql`),
      path.join(dir, `${tag}.sql`),
    );
  }
  return dir;
}

describe("the pending migration", () => {
  it("marks moments kept before it as pending, so they're pushed on first sign-in", () => {
    const db = drizzle(new Database(":memory:"), { schema });
    migrate(db, { migrationsFolder: migrationsUpTo(1) });
    db.$client
      .prepare(
        "insert into moments (id, text, created_at, updated_at) values (?, ?, ?, ?)",
      )
      .run("6f1c1d0e-1c1a-4f6e-9a51-3f3f0b0e2a11", "Old moment", 1, 1);

    migrate(db, { migrationsFolder });

    expect(db.select().from(schema.moments).all()[0].pending).toBe(1);
  });
});

describe("the photo sync migration", () => {
  it("keeps photos kept before it, as local and pending, so they're pushed and uploaded", () => {
    const db = drizzle(new Database(":memory:"), { schema });
    migrate(db, { migrationsFolder: migrationsUpTo(2) });
    db.$client
      .prepare(
        "insert into moments (id, text, created_at, updated_at) values (?, ?, ?, ?)",
      )
      .run("moment-1", "Walk", 1, 1);
    db.$client
      .prepare(
        "insert into moment_photos (id, moment_id, file_name, position, created_at, updated_at) values (?, ?, ?, ?, ?, ?)",
      )
      .run("photo-1", "moment-1", "1793-walk.jpg", 0, 1, 2);

    migrate(db, { migrationsFolder });

    expect(db.select().from(schema.momentPhotos).all()).toEqual([
      {
        id: "photo-1",
        momentId: "moment-1",
        fileName: "1793-walk.jpg",
        position: 0,
        createdAt: 1,
        updatedAt: 2,
        deletedAt: null,
        pending: 1,
        uploadState: "local",
        uploadedAt: null,
      },
    ]);
  });
});
