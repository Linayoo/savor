import { describe, expect, it } from "vitest";
import { newUserId, testDb } from "../../test/db";
import { createDb } from "./client";
import { momentPhotos, moments, userSyncState } from "./schema";

describe("createDb", () => {
  const db = testDb();

  it("talks to Postgres through node-postgres, with the migrations applied", async () => {
    const userId = newUserId();
    await db.insert(userSyncState).values({ userId, version: 2 ** 40 });

    expect(await db.select().from(moments).limit(0)).toEqual([]);
    expect(await db.select().from(momentPhotos).limit(0)).toEqual([]);
    expect(
      (await db.select().from(userSyncState)).find((s) => s.userId === userId),
    ).toEqual({ userId, version: 2 ** 40 });
  });

  it("builds the Neon driver without connecting", async () => {
    const neon = createDb(
      "postgres://user:password@example.eu-central-1.aws.neon.tech/savor",
      "neon",
    );

    expect(neon.db).toBeDefined();
    await neon.close();
  });
});
