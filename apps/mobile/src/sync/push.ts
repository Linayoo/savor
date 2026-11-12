import {
  MAX_PHOTOS_PER_MOMENT,
  MAX_PUSH_ITEMS,
  type PushInput,
} from "@savor/shared";
import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { momentPhotos, moments } from "../db/schema";
import type { AppDb } from "../db/types";
import { SyncError, type SyncApi } from "./api";

// Sends the moments and photo records with local changes to the server,
// moments first, oldest change first, in batches the server accepts (specs
// 005 and 006). Throws a SyncError if a batch fails; batches accepted before
// it stay accepted.
//
// Within the account's quotas (spec 009): photos past the 10th of a moment
// stay on this phone, and after a refusal for new moments per day, deletes
// still go. The refusal is passed on, so the rest waits for the next day.
export async function pushPending(db: AppDb, api: SyncApi) {
  try {
    await pushRows(db, api, "all");
  } catch (error) {
    const newMomentsWait =
      error instanceof SyncError &&
      error.kind === "overQuota" &&
      error.quota === "momentsPerDay";
    if (!newMomentsWait) throw error;
    await pushRows(db, api, "deletes");
    throw error;
  }
}

async function pushRows(db: AppDb, api: SyncApi, rows: "all" | "deletes") {
  const heldBack = photosPastTheLimit(db);
  // The rows pending now. One changed during this push gets a new
  // updated_at, stays pending, and goes in the next sync instead of looping
  // here.
  const pendingIds = (table: typeof moments | typeof momentPhotos) =>
    db
      .select({ id: table.id })
      .from(table)
      .where(
        and(
          eq(table.pending, 1),
          rows === "deletes" ? isNotNull(table.deletedAt) : undefined,
        ),
      )
      .orderBy(asc(table.updatedAt), asc(table.id))
      .all()
      .map((row) => row.id);
  const items = [
    ...pendingIds(moments).map((id) => ({ table: moments, id })),
    ...pendingIds(momentPhotos)
      .filter((id) => !heldBack.has(id))
      .map((id) => ({ table: momentPhotos, id })),
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

// Photos a moment kept past the limit, before there was one: the ones after
// the 10th by position. They're never pushed, so never uploaded, and stay on
// this phone; deleting an earlier photo brings the next one in.
function photosPastTheLimit(db: AppDb): Set<string> {
  const live = db
    .select({ id: momentPhotos.id, momentId: momentPhotos.momentId })
    .from(momentPhotos)
    .where(isNull(momentPhotos.deletedAt))
    .orderBy(
      asc(momentPhotos.momentId),
      asc(momentPhotos.position),
      asc(momentPhotos.id),
    )
    .all();
  const seen = new Map<string, number>();
  const past = new Set<string>();
  for (const { id, momentId } of live) {
    const count = (seen.get(momentId) ?? 0) + 1;
    seen.set(momentId, count);
    if (count > MAX_PHOTOS_PER_MOMENT) past.add(id);
  }
  return past;
}
