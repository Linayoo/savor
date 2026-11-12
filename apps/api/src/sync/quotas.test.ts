import type { MomentChange, PhotoChange, PushInput } from "@savor/shared";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { newUserId, testDb } from "../../test/db";
import { momentPhotos, moments, userSyncState } from "../db/schema";
import { push } from "./push";

const db = testDb();

const t = Date.UTC(2026, 10, 12, 9, 30);
// Late on 12 November, then early the next day (UTC)
const today = () => Date.UTC(2026, 10, 12, 23, 50);
const tomorrow = () => Date.UTC(2026, 10, 13, 0, 10);

const moment = (overrides: Partial<MomentChange> = {}): MomentChange => ({
  id: randomUUID(),
  text: "Ramen with Ana",
  kind: "meal",
  createdAt: t,
  updatedAt: t,
  deletedAt: null,
  ...overrides,
});

const photos = (momentId: string, count: number, from = 0): PhotoChange[] =>
  Array.from({ length: count }, (_, i) => ({
    id: randomUUID(),
    momentId,
    position: from + i,
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
  }));

const refusal = (quota: string) => ({
  code: "TOO_MANY_REQUESTS",
  cause: expect.objectContaining({ quota }),
});

async function stored(userId: string) {
  const [state] = await db
    .select()
    .from(userSyncState)
    .where(eq(userSyncState.userId, userId));
  return {
    moments: await db.select().from(moments).where(eq(moments.userId, userId)),
    photos: await db
      .select()
      .from(momentPhotos)
      .where(eq(momentPhotos.userId, userId)),
    version: state?.version ?? 0,
  };
}

// Pushes `count` new moments in batches of 100, as the phone does
async function pushNewMoments(userId: string, count: number, now = today) {
  for (let i = 0; i < count; i += 100) {
    const batch = Array.from({ length: Math.min(100, count - i) }, () =>
      moment(),
    );
    await push(db, userId, { moments: batch, photos: [] }, now);
  }
}

describe("photos per moment", () => {
  it("refuses a push that leaves a moment with 11 photos, storing nothing from it", async () => {
    const user = newUserId();
    const m = moment();
    await push(db, user, { moments: [m], photos: photos(m.id, 10) }, today);
    const before = await stored(user);

    const input: PushInput = {
      moments: [moment()],
      photos: photos(m.id, 1, 10),
    };
    await expect(push(db, user, input, today)).rejects.toMatchObject(
      refusal("photosPerMoment"),
    );

    expect(await stored(user)).toEqual(before);
  });

  it("refuses 11 photos for a new moment in one push", async () => {
    const user = newUserId();
    const m = moment();

    await expect(
      push(db, user, { moments: [m], photos: photos(m.id, 11) }, today),
    ).rejects.toMatchObject(refusal("photosPerMoment"));
  });

  it("counts only photos that aren't deleted", async () => {
    const user = newUserId();
    const m = moment();
    const ten = photos(m.id, 10);
    await push(db, user, { moments: [m], photos: ten }, today);

    const removed = { ...ten[0], deletedAt: t + 1000, updatedAt: t + 1000 };
    await push(
      db,
      user,
      { moments: [], photos: [removed, ...photos(m.id, 1, 10)] },
      today,
    );

    expect((await stored(user)).photos).toHaveLength(11);
  });

  it("still takes edits and deletes for a moment kept with more photos before the limit", async () => {
    const user = newUserId();
    const m = moment();
    const twelve = photos(m.id, 12);
    // Stored before spec 009, written straight to the table
    await db
      .insert(momentPhotos)
      .values(twelve.map((p, i) => ({ ...p, userId: user, version: i + 1 })));
    await push(db, user, { moments: [m], photos: [] }, today);

    const moved = { ...twelve[1], position: 5, updatedAt: t + 1000 };
    const removed = { ...twelve[0], deletedAt: t + 1000, updatedAt: t + 1000 };
    await push(db, user, { moments: [], photos: [moved, removed] }, today);
    await push(
      db,
      user,
      {
        moments: [{ ...m, deletedAt: t + 2000, updatedAt: t + 2000 }],
        photos: [],
      },
      today,
    );

    expect((await stored(user)).moments[0].deletedAt).toBe(t + 2000);
  });
});

describe("new moments per day", () => {
  it("refuses the 501st new moment of the day, storing nothing from that push", async () => {
    const user = newUserId();
    await pushNewMoments(user, 500);
    const before = await stored(user);

    await expect(
      push(db, user, { moments: [moment()], photos: [] }, today),
    ).rejects.toMatchObject(refusal("momentsPerDay"));

    expect(await stored(user)).toEqual(before);
  });

  it("still takes edits and deletes over the quota", async () => {
    const user = newUserId();
    const kept = moment();
    await push(db, user, { moments: [kept], photos: [] }, today);
    await pushNewMoments(user, 499);

    await push(
      db,
      user,
      {
        moments: [
          { ...kept, text: "Ramen with Ana and Jo", updatedAt: t + 1000 },
        ],
        photos: [],
      },
      today,
    );
    await push(
      db,
      user,
      {
        moments: [{ ...kept, deletedAt: t + 2000, updatedAt: t + 2000 }],
        photos: [],
      },
      today,
    );

    const row = (await stored(user)).moments.find((m) => m.id === kept.id);
    expect(row?.deletedAt).toBe(t + 2000);
  });

  it("doesn't count a moment that arrives already deleted", async () => {
    const user = newUserId();
    await pushNewMoments(user, 500);

    await push(
      db,
      user,
      { moments: [moment({ deletedAt: t + 1000 })], photos: [] },
      today,
    );

    expect((await stored(user)).moments).toHaveLength(501);
  });

  it("takes new moments again the next UTC day", async () => {
    const user = newUserId();
    await pushNewMoments(user, 500);

    await push(db, user, { moments: [moment()], photos: [] }, tomorrow);

    expect((await stored(user)).moments).toHaveLength(501);
  });

  it("counts a moment pushed twice once", async () => {
    const user = newUserId();
    const again = moment();
    await push(db, user, { moments: [again], photos: [] }, today);
    await pushNewMoments(user, 499);

    await push(db, user, { moments: [again], photos: [] }, today);

    expect((await stored(user)).moments).toHaveLength(500);
  });

  it("counts each user on their own", async () => {
    const ana = newUserId();
    const jo = newUserId();
    await pushNewMoments(ana, 500);

    await push(db, jo, { moments: [moment()], photos: [] }, today);

    expect((await stored(jo)).moments).toHaveLength(1);
  });
});
