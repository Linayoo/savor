import { MAX_DOWNLOAD_URLS } from "@savor/shared";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { momentPhotos, moments } from "../db/schema";
import type { AppDb } from "../db/types";
import type { SyncApi } from "./api";
import { forEachInParallel, type PhotoTransfer } from "./photo-transfer";

// Downloads the photos other devices uploaded into the photos folder (spec
// 006), up to 50 URLs per call and three files at a time. Photos whose
// upload hasn't completed are never asked for.
// - downloaded: some photos arrived, so the screens should reload
// - failure: the first error, after every photo was tried
export async function downloadPhotos(
  db: AppDb,
  api: SyncApi,
  transfer: PhotoTransfer,
  {
    deleteFiles,
    onStart,
  }: { deleteFiles: (fileNames: string[]) => void; onStart: () => void },
): Promise<{ downloaded: boolean; failure: unknown }> {
  const waiting = db
    .select({ id: momentPhotos.id })
    .from(momentPhotos)
    .innerJoin(moments, eq(moments.id, momentPhotos.momentId))
    .where(
      and(
        eq(momentPhotos.uploadState, "remote"),
        isNotNull(momentPhotos.uploadedAt),
        isNull(momentPhotos.deletedAt),
        isNull(moments.deletedAt),
      ),
    )
    .orderBy(asc(moments.createdAt), asc(momentPhotos.position))
    .all()
    .map((photo) => photo.id);
  if (waiting.length > 0) onStart();

  let downloaded = false;
  const errors: unknown[] = [];
  for (let i = 0; i < waiting.length; i += MAX_DOWNLOAD_URLS) {
    let urls;
    try {
      ({ urls } = await api.downloadUrls({
        photoIds: waiting.slice(i, i + MAX_DOWNLOAD_URLS),
      }));
    } catch (error) {
      errors.push(error);
      continue;
    }
    // Photos left out were deleted meanwhile; the next pull removes them
    const failed = await forEachInParallel(
      urls,
      3,
      async ({ photoId, url }) => {
        const fileName = await transfer.download(url, photoId);
        const kept = db.transaction((tx) => {
          const still = tx
            .select({ id: momentPhotos.id })
            .from(momentPhotos)
            .where(
              and(
                eq(momentPhotos.id, photoId),
                eq(momentPhotos.uploadState, "remote"),
                isNull(momentPhotos.deletedAt),
              ),
            )
            .get();
          if (!still) return false;
          tx.update(momentPhotos)
            .set({ fileName, uploadState: "uploaded" })
            .where(eq(momentPhotos.id, photoId))
            .run();
          return true;
        });
        // Deleted while it downloaded
        if (!kept) deleteFiles([fileName]);
        downloaded ||= kept;
      },
    );
    errors.push(...failed);
  }
  return { downloaded, failure: errors[0] ?? null };
}
