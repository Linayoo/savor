import type AsyncStorageStatic from "@react-native-async-storage/async-storage";
import { eq } from "drizzle-orm";
import { randomUUID } from "expo-crypto";
import { isMomentKind } from "../kinds";
import { appMeta, momentPhotos, moments } from "./schema";
import type { AppDb } from "./types";

const OLD_KEY = "savor.moments";
const FLAG = "savor.sqliteImported";
const MARKER = "sqliteImported";

type Storage = Pick<typeof AsyncStorageStatic, "getItem" | "setItem">;

type OldMoment = {
  text?: string;
  photos?: string[];
  kind?: string;
  createdAt: number;
};

function parseOldMoments(json: string): OldMoment[] {
  const value: unknown = JSON.parse(json);
  if (
    !Array.isArray(value) ||
    !value.every((m) => typeof m?.createdAt === "number")
  ) {
    throw new Error("Stored moments aren't in the expected shape");
  }
  return value;
}

// Moves moments from AsyncStorage (spec 001) into SQLite once (spec 002).
// The app_meta marker is written in the same transaction as the moments, so
// the import is all or nothing and never runs twice. The old value is kept.
export async function importFromAsyncStorage(
  db: AppDb,
  storage: Storage,
  { newId, now } = { newId: randomUUID, now: Date.now },
): Promise<"imported" | "skipped"> {
  if (await storage.getItem(FLAG)) return "skipped";

  const marker = db.select().from(appMeta).where(eq(appMeta.key, MARKER)).get();
  if (marker) {
    await setFlag(storage);
    return "skipped";
  }

  const json = await storage.getItem(OLD_KEY);
  if (json === null) return "skipped";
  const oldMoments = parseOldMoments(json);

  db.transaction((tx) => {
    for (const old of oldMoments) {
      const id = newId();
      tx.insert(moments)
        .values({
          id,
          text: old.text ?? "",
          kind: isMomentKind(old.kind) ? old.kind : null,
          createdAt: old.createdAt,
          updatedAt: old.createdAt,
        })
        .run();
      (old.photos ?? []).forEach((fileName, position) => {
        tx.insert(momentPhotos)
          .values({
            id: newId(),
            momentId: id,
            fileName,
            position,
            createdAt: old.createdAt,
            updatedAt: old.createdAt,
          })
          .run();
      });
    }
    tx.insert(appMeta)
      .values({ key: MARKER, value: String(now()) })
      .run();
  });

  await setFlag(storage);
  return "imported";
}

// The app_meta marker is the source of truth; if the flag can't be written,
// the next launch finds the marker and sets it then
async function setFlag(storage: Storage) {
  try {
    await storage.setItem(FLAG, "true");
  } catch {}
}
