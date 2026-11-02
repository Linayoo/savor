import { MAX_PUSH_ITEMS, type MomentChange } from "@savor/shared";
import { and, asc, eq, inArray } from "drizzle-orm";
import { moments } from "../db/schema";
import type { AppDb } from "../db/types";
import type { SyncApi } from "./api";

// Sends the moments with local changes to the server, oldest change first, in
// batches the server accepts (spec 005). Throws a SyncError if a batch fails;
// batches accepted before it stay accepted.
export async function pushPending(db: AppDb, api: SyncApi) {
  // The moments pending now. One edited during this push gets a new
  // updated_at, stays pending, and goes in the next sync instead of looping
  // here.
  const ids = db
    .select({ id: moments.id })
    .from(moments)
    .where(eq(moments.pending, 1))
    .orderBy(asc(moments.updatedAt), asc(moments.id))
    .all()
    .map((row) => row.id);

  for (let i = 0; i < ids.length; i += MAX_PUSH_ITEMS) {
    const batch: MomentChange[] = db
      .select()
      .from(moments)
      .where(
        and(
          inArray(moments.id, ids.slice(i, i + MAX_PUSH_ITEMS)),
          eq(moments.pending, 1),
        ),
      )
      .orderBy(asc(moments.updatedAt), asc(moments.id))
      .all()
      .map(({ pending: _, ...change }) => change);
    if (batch.length === 0) continue;

    await api.push({ moments: batch, photos: [] });

    // Only rows still as they were sent are now in sync
    db.transaction((tx) => {
      for (const sent of batch) {
        tx.update(moments)
          .set({ pending: 0 })
          .where(
            and(eq(moments.id, sent.id), eq(moments.updatedAt, sent.updatedAt)),
          )
          .run();
      }
    });
  }
}
