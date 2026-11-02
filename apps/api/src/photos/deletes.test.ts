import type { MomentChange, PhotoChange } from "@savor/shared";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newUserId, testDb } from "../../test/db";
import { FakePhotoStorage } from "../../test/fake-photo-storage";
import { appRouter } from "../router";
import { createCallerFactory } from "../trpc";
import { photoKey } from "./storage";

const db = testDb();
let storage: FakePhotoStorage;
const as = (userId: string) =>
  createCallerFactory(appRouter)({ db, userId, photos: storage });

beforeEach(() => {
  storage = new FakePhotoStorage();
});
afterEach(() => vi.restoreAllMocks());

const t = Date.UTC(2026, 10, 1, 9, 30);
const jpeg = { size: 1000, contentType: "image/jpeg" };

// A moment with two uploaded photos
async function momentWithPhotos(userId = newUserId()) {
  const moment: MomentChange = {
    id: randomUUID(),
    text: "Ramen",
    kind: "meal",
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
  };
  const photos: PhotoChange[] = [0, 1].map((position) => ({
    id: randomUUID(),
    momentId: moment.id,
    position,
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
  }));
  await as(userId).sync.push({ moments: [moment], photos });
  for (const photo of photos) {
    storage.objects.set(photoKey(userId, photo.id), jpeg);
  }
  return { userId, moment, photos };
}

const deleted = <T extends { updatedAt: number }>(row: T) => ({
  ...row,
  deletedAt: t + 1,
  updatedAt: t + 1,
});

describe("a push that deletes photos", () => {
  it("deletes a deleted photo's file and leaves the others", async () => {
    const { userId, photos } = await momentWithPhotos();

    await as(userId).sync.push({ moments: [], photos: [deleted(photos[0])] });

    expect([...storage.objects.keys()]).toEqual([
      photoKey(userId, photos[1].id),
    ]);
  });

  it("deletes every photo file of a deleted moment, even without their records", async () => {
    const { userId, moment } = await momentWithPhotos();
    const other = await momentWithPhotos(userId);

    await as(userId).sync.push({ moments: [deleted(moment)], photos: [] });

    expect([...storage.objects.keys()].sort()).toEqual(
      other.photos.map((p) => photoKey(userId, p.id)).sort(),
    );
  });

  it("still succeeds when the delete fails, and logs it", async () => {
    const { userId, moment } = await momentWithPhotos();
    storage.failDeletes = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await as(userId).sync.push({ moments: [deleted(moment)], photos: [] });

    const { moments } = await as(userId).sync.pull({ sinceVersion: 0 });
    expect(moments[0].deletedAt).toBe(t + 1);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("Couldn't delete 2 photo files"),
      expect.any(Error),
    );
  });

  it("deletes nothing when the push is refused", async () => {
    const ana = await momentWithPhotos();
    const ben = newUserId();

    await expect(
      as(ben).sync.push({ moments: [deleted(ana.moment)], photos: [] }),
    ).rejects.toThrow();

    expect(storage.objects.size).toBe(2);
    expect(storage.deletes).toEqual([]);
  });
});
