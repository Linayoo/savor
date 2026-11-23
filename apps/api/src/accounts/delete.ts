import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  deletedAccounts,
  letterSettings,
  letters,
  momentPhotos,
  moments,
  userQuotaUsage,
  userSyncState,
} from "../db/schema";
import { userFolder, type PhotoStorage } from "../photos/storage";
import { lockSyncState } from "../sync/push";
import type { AccountDirectory } from "./directory";

// Account deletion (spec 010). Every attempt runs every step, and each is
// safe to repeat, so a retry, by the phone or the daily job, completes a
// deletion that stopped partway.

type Step =
  | "mark"
  | "signOutEverywhere"
  | "deleteFiles"
  | "deleteRows"
  | "deleteUser"
  | "finish";

export type DeleteAccountDeps = {
  db: Db;
  photos: PhotoStorage;
  accounts: AccountDirectory;
  userId: string;
  now?: () => number;
  // Steps and counts only, never content
  log?: (line: object) => void;
};

export async function deleteAccount({
  db,
  photos,
  accounts,
  userId,
  now = Date.now,
  log = (line) => console.log(JSON.stringify(line)),
}: DeleteAccountDeps): Promise<{ deleted: true }> {
  let step: Step = "mark";
  try {
    // 1. From here on every protected procedure refuses the account. Under
    // the user's sync lock, so writes in flight commit first and step 4
    // deletes them. A retry keeps the first date.
    await db.transaction(async (tx) => {
      await lockSyncState(tx, userId);
      await tx
        .insert(deletedAccounts)
        .values({ userId, deletedAt: now() })
        .onConflictDoNothing();
    });

    // 2. Other devices can't refresh their tokens anymore
    step = "signOutEverywhere";
    await accounts.signOutEverywhere(userId);

    // 3. The folder, so unconfirmed uploads go too
    step = "deleteFiles";
    const objects = await photos.deleteFolder(userFolder(userId));

    // 4. Every table but deleted_accounts, in one transaction
    step = "deleteRows";
    const rows = await deleteRows(db, userId);

    // 5.
    step = "deleteUser";
    await accounts.deleteUser(userId);

    // 6. The daily job finishes deletions that never got here
    step = "finish";
    await db
      .update(deletedAccounts)
      .set({ finishedAt: now() })
      .where(eq(deletedAccounts.userId, userId));

    log({ event: "account_deleted", userId, objects, rows });
    return { deleted: true };
  } catch (error) {
    log({
      event: "account_delete_failed",
      userId,
      step,
      error: error instanceof Error ? error.name : "unknown",
    });
    throw error;
  }
}

// How many rows went, of all tables together. The sync state goes last: the
// lock taken first holds its row until the commit.
function deleteRows(db: Db, userId: string): Promise<number> {
  return db.transaction(async (tx) => {
    await lockSyncState(tx, userId);
    let rows = 0;
    for (const table of [
      moments,
      momentPhotos,
      letters,
      letterSettings,
      userQuotaUsage,
      userSyncState,
    ]) {
      const deleted = await tx
        .delete(table)
        .where(eq(table.userId, userId))
        .returning({ userId: table.userId });
      rows += deleted.length;
    }
    return rows;
  });
}
