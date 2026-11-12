import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { newUserId, testDb } from "../../test/db";
import { FakePhotoStorage } from "../../test/fake-photo-storage";
import { momentPhotos } from "../db/schema";
import { backfillPhotoSizes } from "./backfill-sizes";
import { photoKey } from "./storage";

const db = testDb();
let storage: FakePhotoStorage;
beforeEach(() => {
  storage = new FakePhotoStorage();
});

const t = Date.UTC(2026, 10, 12, 9, 30);

// A photo record as the server stores it, with its file in storage or not
async function photo(
  userId: string,
  {
    uploadedAt = t as number | null,
    sizeBytes = null as number | null,
    file = null as number | null,
  } = {},
) {
  const id = randomUUID();
  await db.insert(momentPhotos).values({
    id,
    userId,
    momentId: randomUUID(),
    position: 0,
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
    version: 1,
    uploadedAt,
    sizeBytes,
  });
  if (file !== null) {
    storage.objects.set(photoKey(userId, id), {
      size: file,
      contentType: "image/jpeg",
    });
  }
  return id;
}

const sizeOf = async (id: string) =>
  (
    await db
      .select({ sizeBytes: momentPhotos.sizeBytes })
      .from(momentPhotos)
      .where(eq(momentPhotos.id, id))
  )[0].sizeBytes;

describe("backfillPhotoSizes", () => {
  it("fills in the size of confirmed photos from storage", async () => {
    const user = newUserId();
    const a = await photo(user, { file: 2_000_000 });
    const b = await photo(user, { file: 3_500_000 });

    const result = await backfillPhotoSizes(db, storage, { userId: user });

    expect(await sizeOf(a)).toBe(2_000_000);
    expect(await sizeOf(b)).toBe(3_500_000);
    expect(result).toEqual({ filled: 2, missing: [] });
  });

  it("leaves photos alone that have a size, or aren't confirmed", async () => {
    const user = newUserId();
    const sized = await photo(user, { sizeBytes: 1234, file: 9999 });
    const unconfirmed = await photo(user, { uploadedAt: null, file: 9999 });

    await backfillPhotoSizes(db, storage, { userId: user });

    expect(await sizeOf(sized)).toBe(1234);
    expect(await sizeOf(unconfirmed)).toBeNull();
  });

  it("reports confirmed photos whose file is missing, and leaves them unsized", async () => {
    const user = newUserId();
    const gone = await photo(user);

    const result = await backfillPhotoSizes(db, storage, { userId: user });

    expect(await sizeOf(gone)).toBeNull();
    expect(result).toEqual({ filled: 0, missing: [gone] });
  });

  it("changes nothing when run again", async () => {
    const user = newUserId();
    await photo(user, { file: 2_000_000 });
    await backfillPhotoSizes(db, storage, { userId: user });

    expect(await backfillPhotoSizes(db, storage, { userId: user })).toEqual({
      filled: 0,
      missing: [],
    });
  });
});
