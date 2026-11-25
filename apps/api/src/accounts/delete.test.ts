import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { newUserId, testDb } from "../../test/db";
import { FakeAccountDirectory } from "../../test/fake-account-directory";
import { FakePhotoStorage } from "../../test/fake-photo-storage";
import type { Db } from "../db/client";
import {
  deletedAccounts,
  letterSettings,
  letters,
  momentPhotos,
  moments,
  userQuotaUsage,
  userSyncState,
} from "../db/schema";
import { photoKey } from "../photos/storage";
import { appRouter } from "../router";
import { createCallerFactory } from "../trpc";
import { deleteAccount } from "./delete";

const db = testDb();
// Now, so the daily job, tested at the same time on the same database,
// leaves these open deletions alone for their first hour (cleanup.ts)
const t = Date.now();
const later = t + 60_000;

// An account with something in every table, two photo files and an upload
// nobody confirmed, and its Cognito user
async function account(
  storage: FakePhotoStorage,
  cognito: FakeAccountDirectory,
) {
  const userId = newUserId();
  const momentId = randomUUID();
  const photoIds = [randomUUID(), randomUUID()];
  const row = { createdAt: t, updatedAt: t, deletedAt: null, version: 1 };
  await db.insert(moments).values([
    { ...row, id: momentId, userId, text: "Ramen with Ana", kind: "meal" },
    {
      ...row,
      id: randomUUID(),
      userId,
      text: "Rain on the window",
      kind: null,
    },
  ]);
  await db.insert(momentPhotos).values(
    photoIds.map((id, position) => ({
      ...row,
      id,
      userId,
      momentId,
      position,
      uploadedAt: t,
      sizeBytes: 1000,
    })),
  );
  await db.insert(letters).values({
    id: randomUUID(),
    userId,
    month: "2026-10",
    body: "Dear you, ramen with Ana",
    model: "fake-model",
    inputTokens: 1,
    outputTokens: 1,
    createdAt: t,
  });
  await db
    .insert(letterSettings)
    .values({ userId, enabled: true, timeZone: "Europe/Zurich", updatedAt: t });
  await db
    .insert(userQuotaUsage)
    .values({ userId, day: "2026-11-20", newMoments: 2, uploads: 3 });
  await db.insert(userSyncState).values({ userId, version: 1 });
  for (const key of [
    ...photoIds.map((id) => photoKey(userId, id)),
    photoKey(userId, randomUUID()),
  ]) {
    storage.objects.set(key, { size: 1000, contentType: "image/jpeg" });
  }
  cognito.users.add(userId);
  return userId;
}

async function rowsOf(userId: string) {
  const count = async (table: typeof moments | typeof letters) =>
    (await db.select().from(table).where(eq(table.userId, userId))).length;
  return {
    moments: await count(moments),
    photos: (
      await db
        .select()
        .from(momentPhotos)
        .where(eq(momentPhotos.userId, userId))
    ).length,
    letters: await count(letters),
    settings: (
      await db
        .select()
        .from(letterSettings)
        .where(eq(letterSettings.userId, userId))
    ).length,
    quota: (
      await db
        .select()
        .from(userQuotaUsage)
        .where(eq(userQuotaUsage.userId, userId))
    ).length,
    syncState: (
      await db
        .select()
        .from(userSyncState)
        .where(eq(userSyncState.userId, userId))
    ).length,
  };
}

const none = {
  moments: 0,
  photos: 0,
  letters: 0,
  settings: 0,
  quota: 0,
  syncState: 0,
};

const objectsOf = (storage: FakePhotoStorage, userId: string) =>
  [...storage.objects.keys()].filter((key) =>
    key.startsWith(`users/${userId}/`),
  );

const markOf = async (userId: string) =>
  (
    await db
      .select()
      .from(deletedAccounts)
      .where(eq(deletedAccounts.userId, userId))
  )[0];

// The database, with its nth transaction failing: step 1 is the first,
// step 4 the second
function failingTransaction(n: number): Db {
  let calls = 0;
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property !== "transaction")
        return Reflect.get(target, property, receiver);
      return (...args: Parameters<Db["transaction"]>) =>
        ++calls === n
          ? Promise.reject(new Error("The database is unavailable"))
          : target.transaction(...args);
    },
  });
}

// The database, with updates outside a transaction failing: only step 6's
function failingUpdate(): Db {
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property !== "update") return Reflect.get(target, property, receiver);
      return () => {
        throw new Error("The database is unavailable");
      };
    },
  });
}

function setup() {
  const storage = new FakePhotoStorage();
  const cognito = new FakeAccountDirectory();
  const lines: object[] = [];
  const run = (userId: string, now = t, database: Db = db) =>
    deleteAccount({
      db: database,
      photos: storage,
      accounts: cognito,
      userId,
      now: () => now,
      log: (line) => lines.push(line),
    });
  return { storage, cognito, lines, run };
}

describe("deleteAccount", () => {
  it("deletes the sign-in, every row and every file of the account", async () => {
    const { storage, cognito, run } = setup();
    const userId = await account(storage, cognito);

    expect(await run(userId)).toEqual({ deleted: true });

    expect(cognito.users.has(userId)).toBe(false);
    expect(cognito.signedOut).toEqual([userId]);
    expect(objectsOf(storage, userId)).toEqual([]);
    expect(await rowsOf(userId)).toEqual(none);
    expect(await markOf(userId)).toEqual({
      userId,
      deletedAt: t,
      finishedAt: t,
    });
  });

  it("leaves another account's sign-in, rows and files alone", async () => {
    const { storage, cognito, run } = setup();
    const userId = await account(storage, cognito);
    const other = await account(storage, cognito);
    const before = await rowsOf(other);

    await run(userId);

    expect(cognito.users.has(other)).toBe(true);
    expect(cognito.signedOut).not.toContain(other);
    expect(objectsOf(storage, other)).toHaveLength(3);
    expect(await rowsOf(other)).toEqual(before);
    expect(await markOf(other)).toBeUndefined();
  });

  it("logs the steps and counts, never content", async () => {
    const { storage, cognito, lines, run } = setup();
    const userId = await account(storage, cognito);

    await run(userId);

    expect(lines).toContainEqual(
      expect.objectContaining({
        event: "account_deleted",
        userId,
        objects: 3,
        rows: 8,
      }),
    );
    expect(JSON.stringify(lines)).not.toMatch(/Ramen|Rain|Dear you/);
  });

  describe("tried again after a failure", () => {
    const failures: [string, (s: ReturnType<typeof setup>) => Db | void][] = [
      ["marking the account", () => failingTransaction(1)],
      ["revoking the sessions", (s) => s.cognito.failNext("signOutEverywhere")],
      ["deleting the files", (s) => void (s.storage.failDeletes = true)],
      ["deleting the rows", () => failingTransaction(2)],
      ["deleting the Cognito user", (s) => s.cognito.failNext("deleteUser")],
      ["noting that it finished", () => failingUpdate()],
    ];

    it.each(failures)(
      "completes the deletion when %s failed",
      async (_, fail) => {
        const s = setup();
        const userId = await account(s.storage, s.cognito);
        const database = fail(s) ?? db;

        await expect(s.run(userId, t, database)).rejects.toThrow();
        s.storage.failDeletes = false;

        expect(await s.run(userId, later)).toEqual({ deleted: true });
        expect(s.cognito.users.has(userId)).toBe(false);
        expect(objectsOf(s.storage, userId)).toEqual([]);
        expect(await rowsOf(userId)).toEqual(none);
        expect((await markOf(userId))?.finishedAt).toBe(later);
      },
    );

    it("leaves the account marked and unfinished, so it's refused and the daily job can finish it", async () => {
      const s = setup();
      const userId = await account(s.storage, s.cognito);
      s.cognito.failNext("deleteUser");

      await expect(s.run(userId)).rejects.toThrow();

      expect(await markOf(userId)).toEqual({
        userId,
        deletedAt: t,
        finishedAt: null,
      });
      expect(s.lines).toContainEqual(
        expect.objectContaining({
          event: "account_delete_failed",
          userId,
          step: "deleteUser",
        }),
      );
    });
  });

  it("answers the same when run again after it finished, keeping the first date", async () => {
    const { storage, cognito, run } = setup();
    const userId = await account(storage, cognito);
    await run(userId);

    expect(await run(userId, later)).toEqual({ deleted: true });

    expect((await markOf(userId))?.deletedAt).toBe(t);
  });
});

describe("account.delete", () => {
  const callerFor = (userId: string | null, s: ReturnType<typeof setup>) =>
    createCallerFactory(appRouter)({
      db,
      userId,
      photos: s.storage,
      accounts: s.cognito,
    });

  it("deletes the caller's account, from the verified user id", async () => {
    const s = setup();
    const userId = await account(s.storage, s.cognito);

    expect(await callerFor(userId, s).account.delete()).toEqual({
      deleted: true,
    });
    expect(await rowsOf(userId)).toEqual(none);
  });

  it("runs again for an account that's already marked, to finish it", async () => {
    const s = setup();
    const userId = await account(s.storage, s.cognito);
    s.cognito.failNext("deleteUser");
    await expect(callerFor(userId, s).account.delete()).rejects.toThrow();

    expect(await callerFor(userId, s).account.delete()).toEqual({
      deleted: true,
    });
    expect(s.cognito.users.has(userId)).toBe(false);
  });

  it("needs a user", async () => {
    await expect(
      callerFor(null, setup()).account.delete(),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
