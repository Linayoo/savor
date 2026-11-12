import type { MomentChange, PushInput, PushOutput } from "@savor/shared";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Db } from "../db/client";
import { momentPhotos, moments, userSyncState } from "../db/schema";
import { addUsage, LIMITS, quotaExceeded } from "../quotas";

// The incoming value of a column in an upsert
const excluded = (column: PgColumn) => sql.raw(`excluded."${column.name}"`);

// Last write wins, but deletes are final: a deleted row only takes another
// delete. The user check guards against another user's row.
const upsertWhere = (table: typeof moments | typeof momentPhotos): SQL =>
  sql`${table.userId} = ${excluded(table.userId)} and (${table.deletedAt} is null or ${excluded(table.deletedAt)} is not null)`;

// A deleted moment keeps no words: only its id, user, times and version
// (spec 003, ADR 0005)
const tombstone = (change: MomentChange): MomentChange =>
  change.deletedAt === null ? change : { ...change, text: "", kind: null };

// Stores a batch of changes for one user, all or nothing (spec 003), within
// the user's quotas (spec 009)
export function push(
  db: Db,
  userId: string,
  input: PushInput,
  now = Date.now,
): Promise<PushOutput> {
  return db.transaction(async (tx) => {
    let version = await lockVersion(tx, userId);
    await rejectOtherUsersRows(tx, userId, input);
    const newMoments = await countNewMoments(tx, input);
    const gainingPhotos = await momentsGainingPhotos(tx, input);

    for (const change of input.moments) {
      version += 1;
      await tx
        .insert(moments)
        .values({ ...tombstone(change), userId, version })
        .onConflictDoUpdate({
          target: moments.id,
          set: {
            text: excluded(moments.text),
            kind: excluded(moments.kind),
            createdAt: excluded(moments.createdAt),
            updatedAt: excluded(moments.updatedAt),
            deletedAt: excluded(moments.deletedAt),
            version: excluded(moments.version),
          },
          setWhere: upsertWhere(moments),
        });
    }
    for (const change of input.photos) {
      version += 1;
      await tx
        .insert(momentPhotos)
        .values({ ...change, userId, version })
        .onConflictDoUpdate({
          target: momentPhotos.id,
          set: {
            momentId: excluded(momentPhotos.momentId),
            position: excluded(momentPhotos.position),
            createdAt: excluded(momentPhotos.createdAt),
            updatedAt: excluded(momentPhotos.updatedAt),
            deletedAt: excluded(momentPhotos.deletedAt),
            version: excluded(momentPhotos.version),
          },
          setWhere: upsertWhere(momentPhotos),
        });
    }

    await checkPhotosPerMoment(tx, userId, gainingPhotos);
    if (
      newMoments > 0 &&
      (await addUsage(tx, userId, now(), "newMoments", newMoments)) >
        LIMITS.momentsPerDay
    ) {
      throw quotaExceeded("momentsPerDay");
    }

    await saveVersion(tx, userId, version);
    return { version };
  });
}

// The last change for each id in the push, which is what's stored
const lastChanges = <T extends { id: string }>(changes: T[]) => [
  ...new Map(changes.map((c) => [c.id, c])).values(),
];

// Moments the server hasn't seen that arrive live. Edits, deletes and
// moments deleted before they arrived don't count toward the daily quota.
async function countNewMoments(tx: Db, input: PushInput): Promise<number> {
  const live = lastChanges(input.moments).filter((m) => m.deletedAt === null);
  if (live.length === 0) return 0;
  const known = await tx
    .select({ id: moments.id })
    .from(moments)
    .where(
      inArray(
        moments.id,
        live.map((m) => m.id),
      ),
    );
  const knownIds = new Set(known.map((m) => m.id));
  return live.filter((m) => !knownIds.has(m.id)).length;
}

// Moments that gain a live photo in this push: a new photo, or one moved from
// another moment. Only these can go over the limit, so a moment kept with
// more photos before spec 009 still takes edits and deletes.
async function momentsGainingPhotos(
  tx: Db,
  input: PushInput,
): Promise<string[]> {
  const live = lastChanges(input.photos).filter((p) => p.deletedAt === null);
  if (live.length === 0) return [];
  const stored = await tx
    .select({ id: momentPhotos.id, momentId: momentPhotos.momentId })
    .from(momentPhotos)
    .where(
      and(
        inArray(
          momentPhotos.id,
          live.map((p) => p.id),
        ),
        isNull(momentPhotos.deletedAt),
      ),
    );
  const storedIn = new Map(stored.map((p) => [p.id, p.momentId]));
  return [
    ...new Set(
      live
        .filter((p) => storedIn.get(p.id) !== p.momentId)
        .map((p) => p.momentId),
    ),
  ];
}

async function checkPhotosPerMoment(
  tx: Db,
  userId: string,
  momentIds: string[],
) {
  if (momentIds.length === 0) return;
  const [over] = await tx
    .select({ momentId: momentPhotos.momentId })
    .from(momentPhotos)
    .where(
      and(
        eq(momentPhotos.userId, userId),
        inArray(momentPhotos.momentId, momentIds),
        isNull(momentPhotos.deletedAt),
      ),
    )
    .groupBy(momentPhotos.momentId)
    .having(sql`count(*) > ${LIMITS.photosPerMoment}`)
    .limit(1);
  if (over) throw quotaExceeded("photosPerMoment");
}

// Locks the user's version for the rest of the transaction, so concurrent
// writes take turns, and returns it
export async function lockVersion(tx: Db, userId: string): Promise<number> {
  await tx
    .insert(userSyncState)
    .values({ userId, version: 0 })
    .onConflictDoNothing();
  const [state] = await tx
    .select()
    .from(userSyncState)
    .where(eq(userSyncState.userId, userId))
    .for("update");
  return state.version;
}

export async function saveVersion(tx: Db, userId: string, version: number) {
  await tx
    .update(userSyncState)
    .set({ version })
    .where(eq(userSyncState.userId, userId));
}

// A push may not touch another user's moments or photos, or attach a photo
// to another user's moment
async function rejectOtherUsersRows(tx: Db, userId: string, input: PushInput) {
  const momentIds = [
    ...input.moments.map((m) => m.id),
    ...input.photos.map((p) => p.momentId),
  ];
  const photoIds = input.photos.map((p) => p.id);

  const [otherMoment] = momentIds.length
    ? await tx
        .select({ id: moments.id })
        .from(moments)
        .where(and(inArray(moments.id, momentIds), ne(moments.userId, userId)))
        .limit(1)
    : [];
  const [otherPhoto] = photoIds.length
    ? await tx
        .select({ id: momentPhotos.id })
        .from(momentPhotos)
        .where(
          and(
            inArray(momentPhotos.id, photoIds),
            ne(momentPhotos.userId, userId),
          ),
        )
        .limit(1)
    : [];

  if (otherMoment || otherPhoto) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "The push refers to moments or photos of another user",
    });
  }
}
