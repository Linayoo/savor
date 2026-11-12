import { pullOutputSchema, type PullOutput } from "@savor/shared";
import { and, eq, isNull } from "drizzle-orm";
import { getMeta, setMeta } from "../db/app-meta";
import { noWords } from "../db/moments-store";
import { momentPhotos, moments } from "../db/schema";
import type { AppDb } from "../db/types";
import { SyncError, type SyncApi } from "./api";

export type PullDeps = {
  now: () => number;
  // Removes photo files from the phone, after their delete has committed
  deleteFiles: (fileNames: string[]) => void;
  pageSize?: number;
};

// Applies the server's changes since the last pull, page by page (spec 005).
// Each page commits with its version or not at all, so a failed page is
// asked for again next time.
export async function pullChanges(
  db: AppDb,
  api: SyncApi,
  { now, deleteFiles, pageSize = 200 }: PullDeps,
): Promise<{ changed: boolean }> {
  let changed = false;
  let hasMore = true;

  while (hasMore) {
    const sinceVersion = getMeta(db, "lastPulledVersion");
    const page = parsePage(await api.pull({ sinceVersion, limit: pageSize }));

    const deletedFiles = db.transaction((tx) => {
      const files = [
        ...page.moments.flatMap((pulled) => applyMoment(tx, pulled)),
        ...page.photos.flatMap((pulled) => applyPhoto(tx, pulled)),
      ];
      setMeta(tx, "lastPulledVersion", page.version);
      return files;
    });

    if (deletedFiles.length > 0) deleteFiles(deletedFiles);
    changed ||= page.moments.length + page.photos.length > 0;
    hasMore = page.hasMore;
  }

  setMeta(db, "lastSyncedAt", now());
  return { changed };
}

function parsePage(page: PullOutput): PullOutput {
  const parsed = pullOutputSchema.safeParse(page);
  if (!parsed.success) throw new SyncError("rejected", parsed.error.message);
  return parsed.data;
}

// Returns the file names of photos the pulled moment's delete removed
function applyMoment(
  tx: AppDb,
  { version: _, ...change }: PullOutput["moments"][number],
): string[] {
  const isDelete = change.deletedAt !== null;
  // A deleted moment keeps no words, even if the server sent some
  const pulled = isDelete ? { ...change, ...noWords } : change;
  const local = tx
    .select({ pending: moments.pending, deletedAt: moments.deletedAt })
    .from(moments)
    .where(eq(moments.id, pulled.id))
    .get();

  if (!local) {
    tx.insert(moments)
      .values({ ...pulled, pending: 0 })
      .run();
    return [];
  }

  // Local changes win until they're pushed, except against a delete, which
  // is final on the server too
  if (local.pending === 1 && !isDelete) return [];

  tx.update(moments)
    .set({ ...pulled, pending: 0 })
    .where(eq(moments.id, pulled.id))
    .run();
  if (!isDelete) return [];

  const live = and(
    eq(momentPhotos.momentId, pulled.id),
    isNull(momentPhotos.deletedAt),
  );
  const fileNames = tx
    .select({ fileName: momentPhotos.fileName })
    .from(momentPhotos)
    .where(live)
    .all()
    .flatMap((p) => (p.fileName === null ? [] : [p.fileName]));
  tx.update(momentPhotos)
    .set({ deletedAt: pulled.deletedAt, updatedAt: pulled.updatedAt })
    .where(live)
    .run();
  return fileNames;
}

// Photo records follow the moments' rules (spec 006); a new one has no file
// here yet. Returns the file name if the pulled delete removed one.
function applyPhoto(
  tx: AppDb,
  { version: _, ...pulled }: PullOutput["photos"][number],
): string[] {
  const local = tx
    .select({
      pending: momentPhotos.pending,
      deletedAt: momentPhotos.deletedAt,
      fileName: momentPhotos.fileName,
    })
    .from(momentPhotos)
    .where(eq(momentPhotos.id, pulled.id))
    .get();

  if (!local) {
    tx.insert(momentPhotos)
      .values({ ...pulled, fileName: null, pending: 0, uploadState: "remote" })
      .run();
    return [];
  }

  const isDelete = pulled.deletedAt !== null;
  if (local.pending === 1 && !isDelete) return [];
  // A delete is final, as on the server; a moment deleted here or in a pull
  // tombstones its photos before the server may know
  if (local.deletedAt !== null && !isDelete) return [];

  tx.update(momentPhotos)
    .set({ ...pulled, pending: 0 })
    .where(eq(momentPhotos.id, pulled.id))
    .run();
  if (!isDelete || local.deletedAt !== null || local.fileName === null) {
    return [];
  }
  return [local.fileName];
}
