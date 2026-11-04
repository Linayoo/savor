import type { Letter } from "@savor/shared";
import { desc, eq } from "drizzle-orm";
import { letters } from "./schema";
import type { AppDb } from "./types";

// The phone's copy of the server's letters (spec 007). The server is the
// source; the copy is for reading offline.

export function listLetters(db: AppDb): Letter[] {
  return db.select().from(letters).orderBy(desc(letters.month)).all();
}

export function getLetter(db: AppDb, id: string): Letter | null {
  return db.select().from(letters).where(eq(letters.id, id)).get() ?? null;
}

export function replaceLetters(db: AppDb, next: Letter[]) {
  db.transaction((tx) => {
    tx.delete(letters).run();
    if (next.length > 0) tx.insert(letters).values(next).run();
  });
}

export function clearLetters(db: AppDb) {
  db.delete(letters).run();
}
