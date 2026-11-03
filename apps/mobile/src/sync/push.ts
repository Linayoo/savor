import { MAX_PUSH_ITEMS, type PushInput } from "@savor/shared";
import { and, asc, eq, inArray } from "drizzle-orm";
import { momentPhotos, moments } from "../db/schema";
import type { AppDb } from "../db/types";
import type { SyncApi } from "./api";

// Sends the moments and photo records with local changes to the server,
// moments first, oldest change first, in batches the server accepts (specs
// 005 and 006). Throws a SyncError if a batch fails; batches accepted before
// it stay accepted.
export async function pushPending(db: AppDb, api: SyncApi) {
  // The rows pending now. One changed during this push gets a new
  // updated_at, stays pending, and goes in the next sync instead of looping
  // here.
  const pendingIds = (table: typeof moments | typeof momentPhotos) =>
    db
      .select({ id: table.id })
      .from(table)
      .where(eq(table.pending, 1))
      .orderBy(asc(table.updatedAt), asc(table.id))
      .all()
      .map((row) => row.id);
  const items = [
    ...pendingIds(moments).map((id) => ({ table: moments, id })),
    ...pendingIds(momentPhotos).map((id) => ({ table: momentPhotos, id })),
  ];

  for (let i = 0; i < items.length; i += MAX_PUSH_ITEMS) {
    const slice = items.slice(i, i + MAX_PUSH_ITEMS);
    const idsOf = (table: typeof moments | typeof momentPhotos) =>
      slice.filter((item) => item.table === table).map((item) => item.id);
    const momentIds = idsOf(moments);
    const photoIds = idsOf(momentPhotos);
    const batch: PushInput = {
      moments: db
        .select()
        .from(moments)
        .where(and(inArray(moments.id, momentIds), eq(moments.pending, 1)))
        .orderBy(asc(moments.updatedAt), asc(moments.id))
        .all()
        .map(({ pending: _, ...change }) => change),
      photos: db
        .select()
        .from(momentPhotos)
        .where(
          and(inArray(momentPhotos.id, photoIds), eq(momentPhotos.pending, 1)),
        )
        .orderBy(asc(momentPhotos.updatedAt), asc(momentPhotos.id))
        .all()
        .map(({ id, momentId, position, createdAt, updatedAt, deletedAt }) => ({
          id,
          momentId,
          position,
          createdAt,
          updatedAt,
          deletedAt,
        })),
    };
    if (batch.moments.length + batch.photos.length === 0) continue;

    await api.push(batch);

    // Only rows still as they were sent are now in sync
    db.transaction((tx) => {
      for (const [table, sent] of [
        [moments, batch.moments],
        [momentPhotos, batch.photos],
      ] as const) {
        for (const { id, updatedAt } of sent) {
          tx.update(table)
            .set({ pending: 0 })
            .where(and(eq(table.id, id), eq(table.updatedAt, updatedAt)))
            .run();
        }
      }
    });
  }
}
