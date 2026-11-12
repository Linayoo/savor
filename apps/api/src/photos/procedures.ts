import type {
  ConfirmUploadOutput,
  CreateUploadOutput,
  DownloadUrlsOutput,
} from "@savor/shared";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNotNull, isNull, sum } from "drizzle-orm";
import type { Db } from "../db/client";
import { momentPhotos } from "../db/schema";
import { addUsage, LIMITS, quotaExceeded } from "../quotas";
import { lockVersion, saveVersion } from "../sync/push";
import { MAX_PHOTO_BYTES, photoKey, type PhotoStorage } from "./storage";

// The three photo procedures from spec 006. Every one starts from a photo
// record that belongs to the caller and isn't deleted; anything else is
// NOT_FOUND, so another user's ids reveal nothing.

const notFound = () =>
  new TRPCError({ code: "NOT_FOUND", message: "No such photo" });

const ownLivePhoto = (userId: string, photoId: string) =>
  and(
    eq(momentPhotos.id, photoId),
    eq(momentPhotos.userId, userId),
    isNull(momentPhotos.deletedAt),
  );

async function findOwnPhoto(db: Db, userId: string, photoId: string) {
  const [photo] = await db
    .select({ uploadedAt: momentPhotos.uploadedAt })
    .from(momentPhotos)
    .where(ownLivePhoto(userId, photoId));
  if (!photo) throw notFound();
  return photo;
}

// Within the user's quotas (spec 009): uploads per day, and the storage of
// confirmed photos. Under the user's sync lock, so calls take turns.
export async function createUpload(
  db: Db,
  storage: PhotoStorage,
  userId: string,
  photoId: string,
  now = Date.now,
): Promise<CreateUploadOutput> {
  await db.transaction(async (tx) => {
    await lockVersion(tx, userId);
    await findOwnPhoto(tx, userId, photoId);
    if ((await storedBytes(tx, userId)) >= LIMITS.storageBytes) {
      throw quotaExceeded("storage");
    }
    if (
      (await addUsage(tx, userId, now(), "uploads", 1)) > LIMITS.uploadsPerDay
    ) {
      throw quotaExceeded("uploadsPerDay");
    }
  });
  return storage.createUpload(photoKey(userId, photoId));
}

// Confirmed photos that aren't deleted. A deleted photo's file is removed
// from storage (delete-files.ts), so it stops counting.
async function storedBytes(tx: Db, userId: string): Promise<number> {
  const [row] = await tx
    .select({ bytes: sum(momentPhotos.sizeBytes).mapWith(Number) })
    .from(momentPhotos)
    .where(
      and(
        eq(momentPhotos.userId, userId),
        isNull(momentPhotos.deletedAt),
        isNotNull(momentPhotos.uploadedAt),
      ),
    );
  return row?.bytes ?? 0;
}

// Sets uploaded_at and a new version once the file is in storage. Repeating
// it changes nothing.
export async function confirmUpload(
  db: Db,
  storage: PhotoStorage,
  userId: string,
  photoId: string,
  now = Date.now,
): Promise<ConfirmUploadOutput> {
  const found = await findOwnPhoto(db, userId, photoId);
  if (found.uploadedAt !== null) return { uploadedAt: found.uploadedAt };

  // Outside the transaction: no network call while rows are locked
  const key = photoKey(userId, photoId);
  const size = await storage.size(key);
  if (size === null || size > MAX_PHOTO_BYTES) throw notFound();
  // Before the photo counts as uploaded: if this fails, it stays unconfirmed
  // and the phone tries again, rather than a confirmed photo expiring
  await storage.clearPendingTag(key);

  return db.transaction(async (tx) => {
    const version = (await lockVersion(tx, userId)) + 1;
    // Checked again under the lock: a push may have deleted the photo, or a
    // repeated call confirmed it, in the meantime
    const [photo] = await tx
      .select({ uploadedAt: momentPhotos.uploadedAt })
      .from(momentPhotos)
      .where(ownLivePhoto(userId, photoId))
      .for("update");
    if (!photo) throw notFound();
    if (photo.uploadedAt !== null) return { uploadedAt: photo.uploadedAt };

    const uploadedAt = now();
    await tx
      .update(momentPhotos)
      .set({ uploadedAt, sizeBytes: size, version })
      .where(eq(momentPhotos.id, photoId));
    await saveVersion(tx, userId, version);
    return { uploadedAt };
  });
}

// URLs for the caller's uploaded, live photos among photoIds; the rest are
// left out
export async function downloadUrls(
  db: Db,
  storage: PhotoStorage,
  userId: string,
  photoIds: string[],
): Promise<DownloadUrlsOutput> {
  const photos = await db
    .select({ id: momentPhotos.id })
    .from(momentPhotos)
    .where(
      and(
        inArray(momentPhotos.id, photoIds),
        eq(momentPhotos.userId, userId),
        isNull(momentPhotos.deletedAt),
        isNotNull(momentPhotos.uploadedAt),
      ),
    );
  const urls = await Promise.all(
    photos.map(async ({ id }) => ({
      photoId: id,
      url: await storage.downloadUrl(photoKey(userId, id)),
    })),
  );
  return { urls };
}
