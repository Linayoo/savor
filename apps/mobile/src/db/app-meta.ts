import { eq } from "drizzle-orm";
import { appMeta } from "./schema";
import type { AppDb } from "./types";

// The keys the app keeps in app_meta, with their types and defaults. They
// take a transaction too, so they change together with the data.
type Meta = {
  // The account the phone's moments belong to (spec 005)
  ownerUserId: string | null;
  // The highest server version applied by a pull
  lastPulledVersion: number;
  // When the last sync finished, ms since epoch
  lastSyncedAt: number | null;
};

const codecs: {
  [K in keyof Meta]: {
    read: (v: string | null) => Meta[K];
    write: (v: Meta[K]) => string | null;
  };
} = {
  ownerUserId: { read: (v) => v, write: (v) => v },
  lastPulledVersion: {
    read: (v) => (v === null ? 0 : Number(v)),
    write: String,
  },
  lastSyncedAt: {
    read: (v) => (v === null ? null : Number(v)),
    write: (v) => (v === null ? null : String(v)),
  },
};

export function getMeta<K extends keyof Meta>(db: AppDb, key: K): Meta[K] {
  const row = db.select().from(appMeta).where(eq(appMeta.key, key)).get();
  return codecs[key].read(row?.value ?? null);
}

export function setMeta<K extends keyof Meta>(
  db: AppDb,
  key: K,
  value: Meta[K],
) {
  const stored = codecs[key].write(value);
  if (stored === null) {
    db.delete(appMeta).where(eq(appMeta.key, key)).run();
    return;
  }
  db.insert(appMeta)
    .values({ key, value: stored })
    .onConflictDoUpdate({ target: appMeta.key, set: { value: stored } })
    .run();
}
