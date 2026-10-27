import type { PushInput, PushOutput } from "@savor/shared";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Db } from "../db/client";
import { momentPhotos, moments, userSyncState } from "../db/schema";

// The incoming value of a column in an upsert
const excluded = (column: PgColumn) => sql.raw(`excluded."${column.name}"`);

// Last write wins, but deletes are final: a deleted row only takes another
// delete. The user check guards against another user's row.
const upsertWhere = (table: typeof moments | typeof momentPhotos): SQL =>
  sql`${table.userId} = ${excluded(table.userId)} and (${table.deletedAt} is null or ${excluded(table.deletedAt)} is not null)`;

// Stores a batch of changes for one user, all or nothing (spec 003)
export function push(
  db: Db,
  userId: string,
  input: PushInput,
): Promise<PushOutput> {
  return db.transaction(async (tx) => {
    // Lock the user's version so concurrent pushes take turns
    await tx
      .insert(userSyncState)
      .values({ userId, version: 0 })
      .onConflictDoNothing();
    const [state] = await tx
      .select()
      .from(userSyncState)
      .where(eq(userSyncState.userId, userId))
      .for("update");

    await rejectOtherUsersRows(tx, userId, input);

    let version = state.version;
    for (const change of input.moments) {
      version += 1;
      await tx
        .insert(moments)
        .values({ ...change, userId, version })
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

    await tx
      .update(userSyncState)
      .set({ version })
      .where(eq(userSyncState.userId, userId));
    return { version };
  });
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
