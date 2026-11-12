import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { randomUUID } from "expo-crypto";
import type { MomentKind } from "../kinds";
import { momentPhotos, moments } from "./schema";
import type { AppDb } from "./types";

// The shape the screens use; they don't need to know about SQLite
// fileName is null while the photo is on its way from another device
export type MomentPhoto = { id: string; fileName: string | null };

export type Moment = {
  id: string;
  text: string;
  photos?: MomentPhoto[];
  kind?: MomentKind;
  createdAt: number;
};

export type StoreDeps = { newId: () => string; now: () => number };

const defaultDeps: StoreDeps = { newId: randomUUID, now: Date.now };

export function listMoments(db: AppDb): Moment[] {
  const rows = db
    .select()
    .from(moments)
    .where(isNull(moments.deletedAt))
    .orderBy(desc(moments.createdAt))
    .all();
  const photoRows = db
    .select({
      id: momentPhotos.id,
      momentId: momentPhotos.momentId,
      fileName: momentPhotos.fileName,
    })
    .from(momentPhotos)
    .where(isNull(momentPhotos.deletedAt))
    .orderBy(asc(momentPhotos.position))
    .all();

  const photosByMoment = new Map<string, MomentPhoto[]>();
  for (const { id, momentId, fileName } of photoRows) {
    photosByMoment.set(momentId, [
      ...(photosByMoment.get(momentId) ?? []),
      { id, fileName },
    ]);
  }

  return rows.map((row) => ({
    id: row.id,
    text: row.text,
    photos: photosByMoment.get(row.id) ?? [],
    createdAt: row.createdAt,
    ...(row.kind && { kind: row.kind }),
  }));
}

export function insertMoment(
  db: AppDb,
  input: { text: string; photos: string[]; kind?: MomentKind },
  { newId, now }: StoreDeps = defaultDeps,
): Moment {
  const id = newId();
  const time = now();
  const photos = input.photos.map((fileName) => ({ id: newId(), fileName }));

  db.transaction((tx) => {
    tx.insert(moments)
      .values({
        id,
        text: input.text,
        kind: input.kind ?? null,
        createdAt: time,
        updatedAt: time,
      })
      .run();
    if (photos.length > 0) {
      tx.insert(momentPhotos)
        .values(
          photos.map(({ id: photoId, fileName }, position) => ({
            id: photoId,
            momentId: id,
            fileName,
            position,
            createdAt: time,
            updatedAt: time,
          })),
        )
        .run();
    }
  });

  return {
    id,
    text: input.text,
    photos,
    createdAt: time,
    ...(input.kind && { kind: input.kind }),
  };
}

// Passing no kind clears it
export function updateMoment(
  db: AppDb,
  id: string,
  input: { text: string; kind?: MomentKind },
  { now }: StoreDeps = defaultDeps,
) {
  db.update(moments)
    .set({
      text: input.text,
      kind: input.kind ?? null,
      updatedAt: now(),
      pending: 1,
    })
    .where(and(eq(moments.id, id), isNull(moments.deletedAt)))
    .run();
}

// Marks the moment and its photos as deleted and returns the photo file
// names, so the caller can remove the files from the phone. The moment keeps
// no text or kind (spec 003, ADR 0005).
// What a deleted moment keeps of its words
export const noWords = { text: "", kind: null };

export function deleteMoment(
  db: AppDb,
  id: string,
  { now }: StoreDeps = defaultDeps,
): string[] {
  const time = now();
  const live = and(
    eq(momentPhotos.momentId, id),
    isNull(momentPhotos.deletedAt),
  );

  return db.transaction((tx) => {
    const fileNames = tx
      .select({ fileName: momentPhotos.fileName })
      .from(momentPhotos)
      .where(live)
      .orderBy(asc(momentPhotos.position))
      .all()
      .flatMap((p) => (p.fileName === null ? [] : [p.fileName]));

    tx.update(moments)
      .set({ ...noWords, deletedAt: time, updatedAt: time, pending: 1 })
      .where(and(eq(moments.id, id), isNull(moments.deletedAt)))
      .run();
    tx.update(momentPhotos)
      .set({ deletedAt: time, updatedAt: time, pending: 1 })
      .where(live)
      .run();

    return fileNames;
  });
}
