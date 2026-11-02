import type { PushInput } from "@savor/shared";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { momentPhotos } from "../db/schema";
import { photoKey, type PhotoStorage } from "./storage";

// After a push has committed: removes the files of the photos it deleted,
// and of every photo of the moments it deleted (spec 006). A failure is
// logged and doesn't fail the push; the records stay deleted either way.
export async function deletePushedPhotoFiles(
  db: Db,
  storage: PhotoStorage,
  userId: string,
  input: PushInput,
) {
  const photoIds = new Set(
    input.photos.filter((p) => p.deletedAt !== null).map((p) => p.id),
  );
  const deletedMomentIds = input.moments
    .filter((m) => m.deletedAt !== null)
    .map((m) => m.id);
  if (deletedMomentIds.length > 0) {
    const photos = await db
      .select({ id: momentPhotos.id })
      .from(momentPhotos)
      .where(
        and(
          eq(momentPhotos.userId, userId),
          inArray(momentPhotos.momentId, deletedMomentIds),
        ),
      );
    photos.forEach((p) => photoIds.add(p.id));
  }
  if (photoIds.size === 0) return;

  const keys = [...photoIds].map((id) => photoKey(userId, id));
  try {
    await storage.deleteAll(keys);
  } catch (error) {
    console.error(`Couldn't delete ${keys.length} photo files`, error);
  }
}
