import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { newUserId, testDb } from "../../test/db";
import { FakeAccountDirectory } from "../../test/fake-account-directory";
import { FakePhotoStorage } from "../../test/fake-photo-storage";
import { deletedAccounts, letterSettings } from "../db/schema";
import { photoKey } from "../photos/storage";
import { cleanUpDeletedAccounts } from "./cleanup";

// The daily job (spec 010). Other test files leave accounts marked in 2026,
// and the handler test runs this job at the real time. These tests mark
// their open deletions decades earlier, so the job reaches them first, run at
// the real time too, and check only their own accounts.

const db = testDb();
const day = 24 * 60 * 60 * 1000;
const now = Date.now();

function setup() {
  const storage = new FakePhotoStorage();
  const cognito = new FakeAccountDirectory();
  const lines: object[] = [];
  const run = () =>
    cleanUpDeletedAccounts({
      db,
      photos: storage,
      accounts: cognito,
      now: () => now,
      log: (line) => lines.push(line),
    });
  return { storage, cognito, lines, run };
}

// An account whose deletion stopped after step 1
async function openDeletion(s: ReturnType<typeof setup>, deletedAt: number) {
  const userId = newUserId();
  await db.insert(deletedAccounts).values({ userId, deletedAt });
  await db
    .insert(letterSettings)
    .values({ userId, enabled: true, timeZone: "Europe/Zurich", updatedAt: 0 });
  s.storage.objects.set(photoKey(userId, "p1"), {
    size: 1000,
    contentType: "image/jpeg",
  });
  s.cognito.users.add(userId);
  return userId;
}

const markOf = async (userId: string) =>
  (
    await db
      .select()
      .from(deletedAccounts)
      .where(eq(deletedAccounts.userId, userId))
  )[0];

describe("cleanUpDeletedAccounts", () => {
  it("finishes a deletion that stopped partway", async () => {
    const s = setup();
    const userId = await openDeletion(s, Date.UTC(1990, 0, 1));

    await s.run();

    expect(s.cognito.users.has(userId)).toBe(false);
    expect([...s.storage.objects.keys()]).not.toContain(photoKey(userId, "p1"));
    expect(
      await db
        .select()
        .from(letterSettings)
        .where(eq(letterSettings.userId, userId)),
    ).toEqual([]);
    expect((await markOf(userId))?.finishedAt).toBe(now);
  });

  it("keeps a deletion that fails again open, and goes on with the others", async () => {
    const s = setup();
    const failing = await openDeletion(s, Date.UTC(1991, 0, 1));
    const next = await openDeletion(s, Date.UTC(1991, 0, 2));
    s.cognito.failNext("deleteUser");

    await s.run();

    expect((await markOf(failing))?.finishedAt).toBeNull();
    expect((await markOf(next))?.finishedAt).toBe(now);
    // Finished by the next day's run
    await s.run();
    expect((await markOf(failing))?.finishedAt).toBe(now);
  });

  it("leaves a deletion alone for its first hour, while the phone can still retry", async () => {
    const s = setup();
    const userId = await openDeletion(s, now - 59 * 60 * 1000);

    await s.run();

    expect((await markOf(userId))?.finishedAt).toBeNull();
    expect(s.cognito.users.has(userId)).toBe(true);
  });

  it("finishes at most 10 a run, the oldest first", async () => {
    const s = setup();
    const users = [];
    for (let i = 0; i < 11; i++) {
      users.push(await openDeletion(s, Date.UTC(1992, 0, 1 + i)));
    }

    await s.run();

    const finished = await Promise.all(
      users.map(async (u) => (await markOf(u))?.finishedAt ?? null),
    );
    expect(finished.slice(0, 10).every((f) => f === now)).toBe(true);
    expect(finished[10]).toBeNull();
    await s.run();
  });

  it("removes finished deletions after 90 days, and keeps the rest", async () => {
    const s = setup();
    const old = newUserId();
    const recent = newUserId();
    const unfinished = newUserId();
    await db.insert(deletedAccounts).values([
      { userId: old, deletedAt: now - 91 * day, finishedAt: now - 91 * day },
      { userId: recent, deletedAt: now - 89 * day, finishedAt: now - 89 * day },
    ]);
    // Older than 90 days but not finished: kept until it is
    s.cognito.failNext("signOutEverywhere");
    await db
      .insert(deletedAccounts)
      .values({ userId: unfinished, deletedAt: Date.UTC(1980, 0, 1) });

    await s.run();

    expect(await markOf(old)).toBeUndefined();
    expect(await markOf(recent)).toBeDefined();
    expect(await markOf(unfinished)).toBeDefined();
    await s.run();
  });

  it("logs counts only", async () => {
    const s = setup();
    await openDeletion(s, Date.UTC(1993, 0, 1));

    await s.run();

    expect(s.lines).toContainEqual(
      expect.objectContaining({
        event: "accounts_cleanup",
        finished: expect.any(Number),
        failed: expect.any(Number),
        removed: expect.any(Number),
      }),
    );
  });
});
