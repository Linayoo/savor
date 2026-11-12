import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { newUserId, testDb } from "../../test/db";
import { moments } from "./schema";

const db = testDb();
const drizzleDir = path.join(import.meta.dirname, "../../drizzle");
const migration = readFileSync(
  path.join(
    drizzleDir,
    readdirSync(drizzleDir).find((f) => f.endsWith("_scrub_tombstones.sql"))!,
  ),
  "utf8",
);

const t = Date.UTC(2026, 10, 1, 9, 30);

// Tombstones stored before deletes cleared the text, written straight to the
// table as the old push did. The migration already ran on the test database,
// so it runs again here; it only touches deleted rows.
describe("the scrub_tombstones migration", () => {
  it("clears text and kind from deleted moments and leaves live ones alone", async () => {
    const userId = newUserId();
    const row = (text: string, deletedAt: number | null, version: number) => ({
      id: randomUUID(),
      userId,
      text,
      kind: "meal" as const,
      createdAt: t,
      updatedAt: deletedAt ?? t,
      deletedAt,
      version,
    });
    const deleted = row("Ramen with Ana", t + 1000, 1);
    const live = row("Rain on the window", null, 2);
    await db.insert(moments).values([deleted, live]);

    await db.execute(sql.raw(migration));

    const stored = await db
      .select()
      .from(moments)
      .where(eq(moments.userId, userId))
      .orderBy(moments.version);
    expect(stored).toEqual([{ ...deleted, text: "", kind: null }, live]);
  });
});
