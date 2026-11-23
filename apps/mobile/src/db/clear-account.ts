import { inArray, isNotNull } from "drizzle-orm";
import { META_KEYS } from "./app-meta";
import { appMeta, letters, momentPhotos, moments } from "./schema";
import type { AppDb } from "./types";

// Everything of the phone's account, gone from this phone (spec 010): its
// photo files first, then its rows and its app meta in one transaction. If the
// app stops in between, the rows are still there and the next clearing
// deletes them, rather than leaving files nobody points to. Only for a phone
// with an owner: moments kept without one belong to no account.
export function clearAccountData(
  db: AppDb,
  deleteFiles: (fileNames: string[]) => void,
) {
  const files = db
    .select({ fileName: momentPhotos.fileName })
    .from(momentPhotos)
    .where(isNotNull(momentPhotos.fileName))
    .all()
    .map((p) => p.fileName!);
  deleteFiles(files);
  db.transaction((tx) => {
    tx.delete(momentPhotos).run();
    tx.delete(moments).run();
    tx.delete(letters).run();
    tx.delete(appMeta).where(inArray(appMeta.key, META_KEYS)).run();
  });
}
