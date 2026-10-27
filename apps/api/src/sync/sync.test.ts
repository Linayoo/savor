import type { MomentChange, PhotoChange, PushInput } from "@savor/shared";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { newUserId, testDb } from "../../test/db";
import { FAILING_TEXT } from "../../test/env";
import { momentPhotos, moments, userSyncState } from "../db/schema";
import { appRouter } from "../router";
import { createCallerFactory } from "../trpc";

const db = testDb();
const createCaller = createCallerFactory(appRouter);
const as = (userId: string | null) => createCaller({ db, userId });

const t = Date.UTC(2026, 9, 1, 9, 30);

function moment(overrides: Partial<MomentChange> = {}): MomentChange {
  return {
    id: randomUUID(),
    text: "Ramen with Ana",
    kind: "meal",
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
    ...overrides,
  };
}

function photo(
  momentId: string,
  overrides: Partial<PhotoChange> = {},
): PhotoChange {
  return {
    id: randomUUID(),
    momentId,
    position: 0,
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
    ...overrides,
  };
}

// Everything stored for a user, read straight from the tables
async function storedFor(userId: string) {
  const [state] = await db
    .select()
    .from(userSyncState)
    .where(eq(userSyncState.userId, userId));
  return {
    moments: await db
      .select()
      .from(moments)
      .where(eq(moments.userId, userId))
      .orderBy(moments.version),
    photos: await db
      .select()
      .from(momentPhotos)
      .where(eq(momentPhotos.userId, userId))
      .orderBy(momentPhotos.version),
    version: state?.version,
  };
}

const withoutVersion = <T extends { version: number }>(rows: T[]) =>
  rows.map(({ version: _, ...row }) => row);

describe("auth", () => {
  it("rejects push and pull without a user with UNAUTHORIZED", async () => {
    await expect(
      as(null).sync.push({ moments: [moment()], photos: [] }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(as(null).sync.pull({ sinceVersion: 0 })).rejects.toMatchObject(
      { code: "UNAUTHORIZED" },
    );
  });
});

describe("push and pull", () => {
  it("returns two moments and three photos from 0, with increasing versions", async () => {
    const user = newUserId();
    const a = moment({ text: "Ramen" });
    const b = moment({ text: "Rain", kind: null });
    const photos = [photo(a.id), photo(a.id, { position: 1 }), photo(b.id)];

    const pushed = await as(user).sync.push({ moments: [a, b], photos });
    const pulled = await as(user).sync.pull({ sinceVersion: 0 });

    expect(pushed).toEqual({ version: 5 });
    expect(pulled).toEqual({
      moments: [
        { ...a, version: 1 },
        { ...b, version: 2 },
      ],
      photos: [
        { ...photos[0], version: 3 },
        { ...photos[1], version: 4 },
        { ...photos[2], version: 5 },
      ],
      version: 5,
      hasMore: false,
    });
  });

  it("returns the same version and nothing when nothing changed", async () => {
    const user = newUserId();
    await as(user).sync.push({ moments: [moment()], photos: [] });

    expect(await as(user).sync.pull({ sinceVersion: 1 })).toEqual({
      moments: [],
      photos: [],
      version: 1,
      hasMore: false,
    });
  });

  it("pages through changes with no gaps and no repeats", async () => {
    const user = newUserId();
    const a = moment();
    const b = moment();
    await as(user).sync.push({
      moments: [a, b],
      photos: [photo(a.id), photo(a.id, { position: 1 }), photo(b.id)],
    });

    const seen: number[] = [];
    const pages: boolean[] = [];
    let sinceVersion = 0;
    for (let i = 0; i < 10; i++) {
      const page = await as(user).sync.pull({ sinceVersion, limit: 2 });
      seen.push(...[...page.moments, ...page.photos].map((r) => r.version));
      pages.push(page.hasMore);
      sinceVersion = page.version;
      if (!page.hasMore) break;
    }

    expect(seen.sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5]);
    expect(pages).toEqual([true, true, false]);
  });

  it("returns an edited moment once, with the new text and a higher version", async () => {
    const user = newUserId();
    const original = moment({ text: "Soup" });
    await as(user).sync.push({ moments: [original], photos: [] });
    const edited = { ...original, text: "Soup with Ana", updatedAt: t + 1000 };

    await as(user).sync.push({ moments: [edited], photos: [] });

    expect((await as(user).sync.pull({ sinceVersion: 1 })).moments).toEqual([
      { ...edited, version: 2 },
    ]);
    expect((await as(user).sync.pull({ sinceVersion: 0 })).moments).toEqual([
      { ...edited, version: 2 },
    ]);
  });
});

describe("deletes", () => {
  it("keep a deleted moment deleted when a stale edit arrives later", async () => {
    const user = newUserId();
    const original = moment({ text: "Gone soon" });
    const deleted = { ...original, deletedAt: t + 1000, updatedAt: t + 1000 };
    await as(user).sync.push({ moments: [original], photos: [] });
    await as(user).sync.push({ moments: [deleted], photos: [] });

    await as(user).sync.push({
      moments: [{ ...original, text: "Back again", updatedAt: t + 2000 }],
      photos: [],
    });

    const [row] = (await storedFor(user)).moments;
    expect(row).toMatchObject({ text: "Gone soon", deletedAt: t + 1000 });
  });

  it("still apply a later delete to a deleted row", async () => {
    const user = newUserId();
    const original = moment();
    await as(user).sync.push({
      moments: [{ ...original, deletedAt: t + 1000 }],
      photos: [],
    });

    await as(user).sync.push({
      moments: [{ ...original, deletedAt: t + 5000, updatedAt: t + 5000 }],
      photos: [],
    });

    expect((await storedFor(user)).moments[0].deletedAt).toBe(t + 5000);
  });
});

describe("pushing the same batch twice", () => {
  it("leaves the same moments and photos, apart from version", async () => {
    const user = newUserId();
    const a = moment();
    const batch: PushInput = {
      moments: [a, moment({ deletedAt: t + 1 })],
      photos: [photo(a.id), photo(a.id, { position: 1 })],
    };

    await as(user).sync.push(batch);
    const once = await storedFor(user);
    await as(user).sync.push(batch);
    const twice = await storedFor(user);

    expect(withoutVersion(twice.moments)).toEqual(withoutVersion(once.moments));
    expect(withoutVersion(twice.photos)).toEqual(withoutVersion(once.photos));
    expect(twice.version).toBe(8);
  });
});

describe("other users", () => {
  it("can't push a change to another user's moment", async () => {
    const ana = newUserId();
    const ben = newUserId();
    const anasMoment = moment({ text: "Ana's" });
    await as(ana).sync.push({ moments: [anasMoment], photos: [] });
    const before = await storedFor(ana);

    await expect(
      as(ben).sync.push({
        moments: [{ ...anasMoment, text: "Ben's now" }],
        photos: [],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    expect(await storedFor(ana)).toEqual(before);
  });

  it("can't push a change to another user's photo", async () => {
    const ana = newUserId();
    const ben = newUserId();
    const anasMoment = moment();
    const anasPhoto = photo(anasMoment.id);
    await as(ana).sync.push({ moments: [anasMoment], photos: [anasPhoto] });
    const before = await storedFor(ana);

    await expect(
      as(ben).sync.push({
        moments: [],
        photos: [{ ...anasPhoto, momentId: randomUUID() }],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    expect(await storedFor(ana)).toEqual(before);
  });

  it("can't attach a photo to another user's moment, and nothing from the push is stored", async () => {
    const ana = newUserId();
    const ben = newUserId();
    const anasMoment = moment();
    await as(ana).sync.push({ moments: [anasMoment], photos: [] });

    await expect(
      as(ben).sync.push({
        moments: [moment({ text: "Ben's own" })],
        photos: [photo(anasMoment.id)],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    expect(await storedFor(ben)).toEqual({
      moments: [],
      photos: [],
      version: undefined,
    });
  });

  it("never sees another user's rows in a pull", async () => {
    const ana = newUserId();
    const ben = newUserId();
    const anasMoment = moment({ text: "Ana's" });
    await as(ana).sync.push({
      moments: [anasMoment],
      photos: [photo(anasMoment.id)],
    });
    const bensMoment = moment({ text: "Ben's" });
    await as(ben).sync.push({ moments: [bensMoment], photos: [] });

    expect(await as(ben).sync.pull({ sinceVersion: 0 })).toEqual({
      moments: [{ ...bensMoment, version: 1 }],
      photos: [],
      version: 1,
      hasMore: false,
    });
  });
});

describe("concurrent pushes for one user", () => {
  it("give every row a unique version and lose nothing", async () => {
    const user = newUserId();
    const batches = Array.from({ length: 5 }, () => ({
      moments: Array.from({ length: 4 }, () => moment()),
      photos: [],
    }));

    const results = await Promise.all(
      batches.map((batch) => as(user).sync.push(batch)),
    );

    const stored = await storedFor(user);
    expect(stored.moments).toHaveLength(20);
    expect(stored.moments.map((m) => m.version)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
    expect(stored.version).toBe(20);
    expect(results.map((r) => r.version).sort((x, y) => x - y)).toEqual([
      4, 8, 12, 16, 20,
    ]);
  });
});

describe("invalid input", () => {
  const a = moment();
  it.each<[string, PushInput]>([
    ["a bad uuid", { moments: [moment({ id: "not-a-uuid" })], photos: [] }],
    [
      "an unknown kind",
      { moments: [moment({ kind: "dance" as never })], photos: [] },
    ],
    [
      "text over 5000 characters",
      { moments: [moment({ text: "a".repeat(5001) })], photos: [] },
    ],
    [
      "a photo position outside the 32-bit range",
      { moments: [a], photos: [photo(a.id, { position: 2 ** 31 })] },
    ],
    [
      "more than 100 items",
      {
        moments: Array.from({ length: 50 }, () => moment()),
        photos: Array.from({ length: 51 }, () => photo(a.id)),
      },
    ],
  ])("rejects %s with BAD_REQUEST and stores nothing", async (_, input) => {
    const user = newUserId();

    await expect(as(user).sync.push(input)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });

    expect(await storedFor(user)).toEqual({
      moments: [],
      photos: [],
      version: undefined,
    });
  });
});

describe("a push that fails partway", () => {
  it("stores nothing from that push and keeps the user's version", async () => {
    const user = newUserId();
    const first = moment({ text: "first" });
    await as(user).sync.push({ moments: [first], photos: [] });
    const before = await storedFor(user);

    // A new moment and an edit are written before the third write fails in
    // the database
    await expect(
      as(user).sync.push({
        moments: [
          moment({ text: "new" }),
          { ...first, text: "edited", updatedAt: t + 1000 },
          moment({ text: FAILING_TEXT }),
        ],
        photos: [photo(first.id)],
      }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });

    expect(await storedFor(user)).toEqual(before);
    expect(before.version).toBe(1);
  });

  it("stores nothing and keeps the version when the push is rejected for another user's moment", async () => {
    const ana = newUserId();
    const ben = newUserId();
    const anasMoment = moment();
    await as(ana).sync.push({ moments: [anasMoment], photos: [] });
    const bensFirst = moment({ text: "Ben's first" });
    await as(ben).sync.push({ moments: [bensFirst], photos: [] });
    const before = await storedFor(ben);

    // Ben's new moments come first; the last item conflicts with Ana
    await expect(
      as(ben).sync.push({
        moments: [
          moment({ text: "new" }),
          { ...bensFirst, text: "edited" },
          moment({ text: "also new" }),
        ],
        photos: [photo(anasMoment.id)],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    expect(await storedFor(ben)).toEqual(before);
    expect(before.version).toBe(1);
  });
});
