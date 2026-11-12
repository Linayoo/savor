import type { MomentChange, PhotoChange } from "@savor/shared";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { newUserId, testDb } from "../../test/db";
import { FakePhotoStorage } from "../../test/fake-photo-storage";
import { momentPhotos } from "../db/schema";
import { push } from "../sync/push";
import { confirmUpload, createUpload } from "./procedures";

const db = testDb();
let storage: FakePhotoStorage;
beforeEach(() => {
  storage = new FakePhotoStorage();
});

const t = Date.UTC(2026, 10, 12, 9, 30);
const today = () => Date.UTC(2026, 10, 12, 23, 50);
const tomorrow = () => Date.UTC(2026, 10, 13, 0, 10);
const MB = 1024 * 1024;
const GB = 1024 * MB;

const refusal = (quota: string) => ({
  code: "TOO_MANY_REQUESTS",
  cause: expect.objectContaining({ quota }),
});

// A user with moments of up to 10 photos each, all on the server
async function userWithPhotos(count: number) {
  const userId = newUserId();
  const moments: MomentChange[] = [];
  const photos: PhotoChange[] = [];
  for (let i = 0; i < count; i++) {
    if (i % 10 === 0) {
      moments.push({
        id: randomUUID(),
        text: "Ramen",
        kind: "meal",
        createdAt: t,
        updatedAt: t,
        deletedAt: null,
      });
    }
    photos.push({
      id: randomUUID(),
      momentId: moments.at(-1)!.id,
      position: i % 10,
      createdAt: t,
      updatedAt: t,
      deletedAt: null,
    });
  }
  await push(db, userId, { moments, photos }, today);
  return { userId, moments, photos };
}

// Marks photos as confirmed with a size, as confirmUpload leaves them
async function confirmed(photos: PhotoChange[], sizeBytes: number) {
  for (const photo of photos) {
    await db
      .update(momentPhotos)
      .set({ uploadedAt: t, sizeBytes })
      .where(eq(momentPhotos.id, photo.id));
  }
}

describe("uploads per day", () => {
  it("refuses the 301st createUpload of the day, and takes it the next day", async () => {
    const { userId, photos } = await userWithPhotos(1);
    for (let i = 0; i < 300; i++) {
      await createUpload(db, storage, userId, photos[0].id, today);
    }

    await expect(
      createUpload(db, storage, userId, photos[0].id, today),
    ).rejects.toMatchObject(refusal("uploadsPerDay"));
    await createUpload(db, storage, userId, photos[0].id, tomorrow);
  });

  it("counts each user on their own", async () => {
    const ana = await userWithPhotos(1);
    const jo = await userWithPhotos(1);
    for (let i = 0; i < 300; i++) {
      await createUpload(db, storage, ana.userId, ana.photos[0].id, today);
    }

    await createUpload(db, storage, jo.userId, jo.photos[0].id, today);
  });
});

describe("photo storage", () => {
  it("refuses createUpload once confirmed photos reach 5 GB", async () => {
    const { userId, photos } = await userWithPhotos(11);
    await confirmed(photos.slice(0, 10), GB / 2);

    await expect(
      createUpload(db, storage, userId, photos[10].id, today),
    ).rejects.toMatchObject(refusal("storage"));
  });

  it("takes uploads again after a moment with photos is deleted", async () => {
    const { userId, moments, photos } = await userWithPhotos(11);
    await confirmed(photos.slice(0, 10), GB / 2);

    // As the phone deletes a moment: the moment and its photos
    await push(
      db,
      userId,
      {
        moments: [{ ...moments[0], deletedAt: t + 1000, updatedAt: t + 1000 }],
        photos: photos
          .slice(0, 10)
          .map((p) => ({ ...p, deletedAt: t + 1000, updatedAt: t + 1000 })),
      },
      today,
    );

    await createUpload(db, storage, userId, photos[10].id, today);
  });

  it("doesn't count uploads that were never confirmed", async () => {
    const { userId, photos } = await userWithPhotos(11);
    for (const photo of photos.slice(0, 10)) {
      await db
        .update(momentPhotos)
        .set({ sizeBytes: GB / 2 })
        .where(eq(momentPhotos.id, photo.id));
    }

    await createUpload(db, storage, userId, photos[10].id, today);
  });
});

describe("confirmUpload", () => {
  it("stores the photo's size", async () => {
    const { userId, photos } = await userWithPhotos(1);
    const form = await createUpload(db, storage, userId, photos[0].id, today);
    await storage.upload(form, { size: 3 * MB, contentType: "image/jpeg" });

    await confirmUpload(db, storage, userId, photos[0].id);

    const [row] = await db
      .select()
      .from(momentPhotos)
      .where(eq(momentPhotos.id, photos[0].id));
    expect(row.sizeBytes).toBe(3 * MB);
  });
});
