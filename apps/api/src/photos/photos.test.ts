import type { MomentChange, PhotoChange } from "@savor/shared";
import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { newUserId, testDb } from "../../test/db";
import { FakePhotoStorage, S3Refused } from "../../test/fake-photo-storage";
import { appRouter } from "../router";
import { createCallerFactory } from "../trpc";
import { photoKey } from "./storage";

const db = testDb();
let storage: FakePhotoStorage;
const as = (userId: string | null) =>
  createCallerFactory(appRouter)({ db, userId, photos: storage });

beforeEach(() => {
  storage = new FakePhotoStorage();
});

const t = Date.UTC(2026, 10, 1, 9, 30);
const KB = 1024;
const MB = 1024 * KB;
const jpeg = (size = 300 * KB) => ({ size, contentType: "image/jpeg" });

// A user with one moment and one photo on the server
async function userWithPhoto(photo: Partial<PhotoChange> = {}) {
  const userId = newUserId();
  const moment: MomentChange = {
    id: randomUUID(),
    text: "Ramen",
    kind: "meal",
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
  };
  const change: PhotoChange = {
    id: randomUUID(),
    momentId: moment.id,
    position: 0,
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
    ...photo,
  };
  await as(userId).sync.push({ moments: [moment], photos: [change] });
  return { userId, moment, photo: change };
}

async function uploaded() {
  const user = await userWithPhoto();
  const form = await as(user.userId).photos.createUpload({
    photoId: user.photo.id,
  });
  await storage.upload(form, jpeg());
  await as(user.userId).photos.confirmUpload({ photoId: user.photo.id });
  return user;
}

const notFound = expect.objectContaining({ code: "NOT_FOUND" });
const refused = (code: string) => expect.objectContaining({ code });

describe("photos.createUpload", () => {
  it("returns a form that stores one JPEG at the key built from the signed-in user", async () => {
    const { userId, photo } = await userWithPhoto();

    const form = await as(userId).photos.createUpload({ photoId: photo.id });
    await storage.upload(form, jpeg());

    expect(form.fields.key).toBe(`users/${userId}/photos/${photo.id}.jpg`);
    expect(storage.objects.get(photoKey(userId, photo.id))).toEqual(jpeg());
  });

  it("is refused without a signed-in user", async () => {
    const { photo } = await userWithPhoto();

    await expect(
      as(null).photos.createUpload({ photoId: photo.id }),
    ).rejects.toEqual(expect.objectContaining({ code: "UNAUTHORIZED" }));
  });

  it("is NOT_FOUND for another user's photo", async () => {
    const ana = await userWithPhoto();
    const ben = newUserId();

    await expect(
      as(ben).photos.createUpload({ photoId: ana.photo.id }),
    ).rejects.toEqual(notFound);
  });

  it("is NOT_FOUND for an unknown or deleted photo", async () => {
    const { userId } = await userWithPhoto();
    const deleted = await userWithPhoto({ deletedAt: t });

    await expect(
      as(userId).photos.createUpload({ photoId: randomUUID() }),
    ).rejects.toEqual(notFound);
    await expect(
      as(deleted.userId).photos.createUpload({ photoId: deleted.photo.id }),
    ).rejects.toEqual(notFound);
  });

  describe("the form S3 gets", () => {
    it("refuses a file over 10 MB", async () => {
      const { userId, photo } = await userWithPhoto();
      const form = await as(userId).photos.createUpload({ photoId: photo.id });

      await expect(storage.upload(form, jpeg(10 * MB + 1))).rejects.toEqual(
        refused("EntityTooLarge"),
      );
      await storage.upload(form, jpeg(10 * MB));
    });

    it("refuses an empty file", async () => {
      const { userId, photo } = await userWithPhoto();
      const form = await as(userId).photos.createUpload({ photoId: photo.id });

      await expect(storage.upload(form, jpeg(0))).rejects.toEqual(
        refused("EntityTooSmall"),
      );
    });

    it("refuses another content type", async () => {
      const { userId, photo } = await userWithPhoto();
      const form = await as(userId).photos.createUpload({ photoId: photo.id });

      await expect(
        storage.upload(form, { size: 300 * KB, contentType: "image/png" }),
      ).rejects.toEqual(refused("AccessDenied"));
    });

    it("refuses another key, so the phone can't choose one", async () => {
      const { userId, photo } = await userWithPhoto();
      const form = await as(userId).photos.createUpload({ photoId: photo.id });
      const otherKey = {
        ...form,
        fields: { ...form.fields, key: `users/${newUserId()}/photos/x.jpg` },
      };

      await expect(storage.upload(otherKey, jpeg())).rejects.toEqual(
        refused("AccessDenied"),
      );
      expect(storage.objects.size).toBe(0);
    });

    it("stops working after 5 minutes", async () => {
      const { userId, photo } = await userWithPhoto();
      const issued = Date.now();
      storage.now = () => issued;
      const form = await as(userId).photos.createUpload({ photoId: photo.id });

      storage.now = () => issued + 5 * 60_000 + 1;
      await expect(storage.upload(form, jpeg())).rejects.toBeInstanceOf(
        S3Refused,
      );
    });
  });
});

describe("photos.confirmUpload", () => {
  it("marks the photo uploaded with a new version, so other devices learn about it", async () => {
    const { userId, photo } = await userWithPhoto();
    const { version: before } = await as(userId).sync.pull({ sinceVersion: 0 });
    const form = await as(userId).photos.createUpload({ photoId: photo.id });
    await storage.upload(form, jpeg());

    const { uploadedAt } = await as(userId).photos.confirmUpload({
      photoId: photo.id,
    });
    const pulled = await as(userId).sync.pull({ sinceVersion: before });

    expect(uploadedAt).toBeGreaterThan(0);
    expect(pulled.photos).toEqual([
      { ...photo, version: before + 1, uploadedAt },
    ]);
    expect(pulled.moments).toEqual([]);
  });

  it("clears the pending tag the upload form set, so the photo isn't expired", async () => {
    const { userId, photo } = await userWithPhoto();
    const form = await as(userId).photos.createUpload({ photoId: photo.id });
    await storage.upload(form, jpeg());
    const key = photoKey(userId, photo.id);
    expect(storage.tags.get(key)).toEqual({ upload: "pending" });

    await as(userId).photos.confirmUpload({ photoId: photo.id });

    expect(storage.tags.get(key)).toEqual({});
  });

  it("stays unconfirmed when the tag can't be cleared, so the phone tries again", async () => {
    const { userId, photo } = await userWithPhoto();
    const form = await as(userId).photos.createUpload({ photoId: photo.id });
    await storage.upload(form, jpeg());
    storage.failTagging = true;

    await expect(
      as(userId).photos.confirmUpload({ photoId: photo.id }),
    ).rejects.toThrow();

    const { photos } = await as(userId).sync.pull({ sinceVersion: 0 });
    expect(photos[0].uploadedAt).toBeNull();
  });

  it("is harmless to repeat: same time, no new version", async () => {
    const { userId, photo } = await uploaded();
    const { version } = await as(userId).sync.pull({ sinceVersion: 0 });
    const first = await as(userId).sync.pull({ sinceVersion: version - 1 });

    const again = await as(userId).photos.confirmUpload({ photoId: photo.id });

    expect(again.uploadedAt).toBe(first.photos[0].uploadedAt);
    expect(
      (await as(userId).sync.pull({ sinceVersion: version })).photos,
    ).toEqual([]);
  });

  it("keeps uploadedAt when the photo record is pushed again", async () => {
    const { userId, photo } = await uploaded();

    await as(userId).sync.push({
      moments: [],
      photos: [{ ...photo, position: 1, updatedAt: t + 1 }],
    });
    const { photos } = await as(userId).sync.pull({ sinceVersion: 0 });

    expect(photos[0]).toMatchObject({ position: 1 });
    expect(photos[0].uploadedAt).toEqual(expect.any(Number));
  });

  it("is NOT_FOUND when the file never arrived", async () => {
    const { userId, photo } = await userWithPhoto();

    await expect(
      as(userId).photos.confirmUpload({ photoId: photo.id }),
    ).rejects.toEqual(notFound);
    const { photos } = await as(userId).sync.pull({ sinceVersion: 0 });
    expect(photos[0].uploadedAt).toBeNull();
  });

  it("is NOT_FOUND for an object over 10 MB, put there some other way", async () => {
    const { userId, photo } = await userWithPhoto();
    storage.objects.set(photoKey(userId, photo.id), jpeg(10 * MB + 1));

    await expect(
      as(userId).photos.confirmUpload({ photoId: photo.id }),
    ).rejects.toEqual(notFound);
  });

  it("is NOT_FOUND for another user's photo, even with its file there", async () => {
    const ana = await userWithPhoto();
    const ben = newUserId();
    const form = await as(ana.userId).photos.createUpload({
      photoId: ana.photo.id,
    });
    await storage.upload(form, jpeg());

    await expect(
      as(ben).photos.confirmUpload({ photoId: ana.photo.id }),
    ).rejects.toEqual(notFound);
  });

  it("is NOT_FOUND for an unknown or deleted photo", async () => {
    const { userId } = await userWithPhoto();
    const deleted = await userWithPhoto({ deletedAt: t });
    storage.objects.set(photoKey(deleted.userId, deleted.photo.id), jpeg());

    await expect(
      as(userId).photos.confirmUpload({ photoId: randomUUID() }),
    ).rejects.toEqual(notFound);
    await expect(
      as(deleted.userId).photos.confirmUpload({ photoId: deleted.photo.id }),
    ).rejects.toEqual(notFound);
  });
});

describe("photos.downloadUrls", () => {
  it("returns a URL for each of the caller's uploaded photos, which works for 15 minutes", async () => {
    const { userId, photo } = await uploaded();
    const issued = Date.now();
    storage.now = () => issued;

    const { urls } = await as(userId).photos.downloadUrls({
      photoIds: [photo.id],
    });

    expect(urls.map((u) => u.photoId)).toEqual([photo.id]);
    expect(storage.get(urls[0].url)).toEqual(jpeg());
    storage.now = () => issued + 15 * 60_000 + 1;
    expect(() => storage.get(urls[0].url)).toThrow(S3Refused);
  });

  it("leaves out another user's photos, and photos that are unknown, deleted or not uploaded", async () => {
    const ana = await uploaded();
    const ben = await uploaded();
    const notUploaded = await userWithPhoto();
    await as(ben.userId).sync.push({
      moments: [],
      photos: [{ ...ben.photo, deletedAt: t + 1, updatedAt: t + 1 }],
    });

    const forBen = await as(ben.userId).photos.downloadUrls({
      photoIds: [ana.photo.id, ben.photo.id, randomUUID()],
    });
    const forNotUploaded = await as(notUploaded.userId).photos.downloadUrls({
      photoIds: [notUploaded.photo.id],
    });

    expect(forBen.urls).toEqual([]);
    expect(forNotUploaded.urls).toEqual([]);
  });

  it("takes at most 50 ids", async () => {
    const { userId } = await userWithPhoto();

    await expect(
      as(userId).photos.downloadUrls({
        photoIds: Array.from({ length: 51 }, () => randomUUID()),
      }),
    ).rejects.toBeInstanceOf(TRPCError);
  });
});
