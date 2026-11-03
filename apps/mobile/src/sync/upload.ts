import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { momentPhotos } from "../db/schema";
import type { AppDb } from "../db/types";
import { SyncError, type SyncApi } from "./api";
import { forEachInParallel, type PhotoTransfer } from "./photo-transfer";

// Uploads the files of photos kept here, once the server has their records
// (spec 006). Database writes are synchronous; the network and file work
// happen between them.
// - missingFiles: photos with no file left, now tombstoned and pending
// - failure: the first error worth retrying, after every photo was tried
export async function uploadPhotos(
  db: AppDb,
  api: SyncApi,
  transfer: PhotoTransfer,
  now: () => number,
): Promise<{ missingFiles: boolean; failure: unknown }> {
  const waiting = db
    .select({ id: momentPhotos.id, fileName: momentPhotos.fileName })
    .from(momentPhotos)
    .where(
      and(
        eq(momentPhotos.uploadState, "local"),
        eq(momentPhotos.pending, 0),
        isNull(momentPhotos.deletedAt),
        isNotNull(momentPhotos.fileName),
      ),
    )
    .orderBy(asc(momentPhotos.createdAt), asc(momentPhotos.position))
    .all();

  let missingFiles = false;
  const errors = await forEachInParallel(waiting, 3, async (photo) => {
    const fileName = photo.fileName!;
    // Nothing left to upload, such as a temporary file from before spec 001:
    // the photo leaves its moment on every device, like a deleted one
    if (!transfer.exists(fileName)) {
      const time = now();
      db.update(momentPhotos)
        .set({ deletedAt: time, updatedAt: time, pending: 1 })
        .where(
          and(eq(momentPhotos.id, photo.id), isNull(momentPhotos.deletedAt)),
        )
        .run();
      missingFiles = true;
      return;
    }

    const copy = await transfer.uploadCopy(fileName);
    try {
      const form = await api.createUpload({ photoId: photo.id });
      await transfer.upload(form, copy);
      await api.confirmUpload({ photoId: photo.id });
    } finally {
      transfer.discard(copy);
    }
    db.update(momentPhotos)
      .set({ uploadState: "uploaded" })
      .where(
        and(
          eq(momentPhotos.id, photo.id),
          eq(momentPhotos.uploadState, "local"),
        ),
      )
      .run();
  });

  // NOT_FOUND: the photo was deleted elsewhere; the next pull removes it
  const failure =
    errors.find((e) => !(e instanceof SyncError && e.kind === "notFound")) ??
    null;
  return { missingFiles, failure };
}
