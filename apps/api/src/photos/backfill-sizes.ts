import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { momentPhotos } from "../db/schema";
import { photoKey, type PhotoStorage } from "./storage";

// Fills in size_bytes for photos confirmed before confirmUpload stored it
// (spec 009), from the files in storage, so they count toward the storage
// quota. Run once with scripts/backfill-photo-sizes.ts; running it again
// changes nothing. A confirmed photo with no file is reported and left as is.
export async function backfillPhotoSizes(
  db: Db,
  storage: PhotoStorage,
  // Tests limit it to one user; the script runs it for everyone
  { userId }: { userId?: string } = {},
): Promise<{ filled: number; missing: string[] }> {
  const unsized = await db
    .select({ id: momentPhotos.id, userId: momentPhotos.userId })
    .from(momentPhotos)
    .where(
      and(
        isNotNull(momentPhotos.uploadedAt),
        isNull(momentPhotos.sizeBytes),
        isNull(momentPhotos.deletedAt),
        userId === undefined ? undefined : eq(momentPhotos.userId, userId),
      ),
    );

  let filled = 0;
  const missing: string[] = [];
  for (const photo of unsized) {
    const size = await storage.size(photoKey(photo.userId, photo.id));
    if (size === null) {
      missing.push(photo.id);
      continue;
    }
    await db
      .update(momentPhotos)
      .set({ sizeBytes: size })
      .where(
        and(eq(momentPhotos.id, photo.id), isNull(momentPhotos.sizeBytes)),
      );
    filled += 1;
  }
  return { filled, missing };
}
