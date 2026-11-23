import { and, asc, isNull, lt } from "drizzle-orm";
import type { Db } from "../db/client";
import { deletedAccounts } from "../db/schema";
import type { PhotoStorage } from "../photos/storage";
import { deleteAccount } from "./delete";
import type { AccountDirectory } from "./directory";

// The daily job (spec 010), run by a schedule at 04:00 in Zurich
// (infra/app/accounts.tf). It finishes deletions that stopped partway, which
// the phone may not be able to try again once its session is revoked, then
// forgets deleted accounts 90 days after their deletion finished.

const KEEP_MS = 90 * 24 * 60 * 60 * 1000;
// The phone refreshes its tokens before deleting, so it can retry for an
// hour; the job takes over after that
const PHONE_RETRY_MS = 60 * 60 * 1000;
// Leaves room in the API function's 15 seconds
const MAX_FINISHED_PER_RUN = 10;

export type CleanupSummary = {
  finished: number;
  failed: number;
  removed: number;
};

export async function cleanUpDeletedAccounts({
  db,
  photos,
  accounts,
  now = Date.now,
  log = (line) => console.log(JSON.stringify(line)),
}: {
  db: Db;
  photos: PhotoStorage;
  accounts: AccountDirectory;
  now?: () => number;
  log?: (line: object) => void;
}): Promise<CleanupSummary> {
  const summary: CleanupSummary = { finished: 0, failed: 0, removed: 0 };

  const open = await db
    .select({ userId: deletedAccounts.userId })
    .from(deletedAccounts)
    .where(
      and(
        isNull(deletedAccounts.finishedAt),
        lt(deletedAccounts.deletedAt, now() - PHONE_RETRY_MS),
      ),
    )
    .orderBy(asc(deletedAccounts.deletedAt))
    .limit(MAX_FINISHED_PER_RUN);
  for (const { userId } of open) {
    // deleteAccount logs the step that failed; tomorrow's run tries again
    try {
      await deleteAccount({ db, photos, accounts, userId, now, log });
      summary.finished++;
    } catch {
      summary.failed++;
    }
  }

  // Counted from the end, so a deletion the job finished late is still
  // there for 90 days; an open one stays until it's done
  const removed = await db
    .delete(deletedAccounts)
    .where(lt(deletedAccounts.finishedAt, now() - KEEP_MS))
    .returning({ userId: deletedAccounts.userId });
  summary.removed = removed.length;

  log({ event: "accounts_cleanup", ...summary });
  return summary;
}
