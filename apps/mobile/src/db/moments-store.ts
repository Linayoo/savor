import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { randomUUID } from "expo-crypto";
import type { MomentKind } from "../kinds";
import { momentPhotos, moments } from "./schema";
import type { AppDb } from "./types";

// The shape the screens use; they don't need to know about SQLite
export type Moment = {
  id: string;
  text: string;
  photos?: string[];
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
      momentId: momentPhotos.momentId,
      fileName: momentPhotos.fileName,
    })
    .from(momentPhotos)
    .where(isNull(momentPhotos.deletedAt))
    .orderBy(asc(momentPhotos.position))
    .all();

  const photosByMoment = new Map<string, string[]>();
  for (const { momentId, fileName } of photoRows) {
    photosByMoment.set(momentId, [
      ...(photosByMoment.get(momentId) ?? []),
      fileName,
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
    if (input.photos.length > 0) {
      tx.insert(momentPhotos)
        .values(
          input.photos.map((fileName, position) => ({
            id: newId(),
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
    photos: input.photos,
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
    .set({ text: input.text, kind: input.kind ?? null, updatedAt: now() })
    .where(and(eq(moments.id, id), isNull(moments.deletedAt)))
    .run();
}

// Marks the moment and its photos as deleted and returns the photo file
// names, so the caller can remove the files from the phone
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
      .map((p) => p.fileName);

    tx.update(moments)
      .set({ deletedAt: time, updatedAt: time })
      .where(and(eq(moments.id, id), isNull(moments.deletedAt)))
      .run();
    tx.update(momentPhotos)
      .set({ deletedAt: time, updatedAt: time })
      .where(live)
      .run();

    return fileNames;
  });
}
