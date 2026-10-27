import AsyncStorage from "@react-native-async-storage/async-storage";
import { randomUUID } from "node:crypto";
import { appMeta, momentPhotos, moments } from "@/db/schema";
import { importFromAsyncStorage } from "@/db/import-async-storage";
import { listMoments } from "@/db/moments-store";
import { createTestDb } from "@/test-utils/db";

const OLD_KEY = "savor.moments";
const FLAG = "savor.sqliteImported";
const UUID = /^[0-9a-f-]{36}$/;

// Moments as spec 001 stored them: newest first, ids from Date.now()
const oct1 = Date.UTC(2026, 9, 1, 9, 30);
const sep20 = Date.UTC(2026, 8, 20, 18, 0);
const aug2 = Date.UTC(2026, 7, 2, 7, 15);
const jul9 = Date.UTC(2026, 6, 9, 12, 0);
const oldMoments = [
  {
    id: String(oct1),
    text: "Ramen with Ana",
    photos: ["1-a.jpg", "1-b.jpg", "1-c.jpg"],
    kind: "meal",
    createdAt: oct1,
  },
  { id: String(sep20), text: "Rain on the window", createdAt: sep20 },
  {
    id: String(aug2),
    text: "",
    photos: ["file:///var/mobile/tmp/old.jpg"],
    createdAt: aug2,
  },
  { id: String(jul9), text: "Tango", kind: "dance", createdAt: jul9 },
];
const oldJson = JSON.stringify(oldMoments);

const deps = { newId: randomUUID, now: () => Date.UTC(2026, 9, 27) };

function counts(db: ReturnType<typeof createTestDb>) {
  return {
    moments: db.select().from(moments).all().length,
    photos: db.select().from(momentPhotos).all().length,
    meta: db.select().from(appMeta).all().length,
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await AsyncStorage.setItem(OLD_KEY, oldJson);
});

describe("importFromAsyncStorage", () => {
  it("moves every moment with its text, kind, photos in order and date", async () => {
    const db = createTestDb();

    await expect(importFromAsyncStorage(db, AsyncStorage, deps)).resolves.toBe(
      "imported",
    );

    expect(listMoments(db)).toEqual([
      {
        id: expect.stringMatching(UUID),
        text: "Ramen with Ana",
        photos: ["1-a.jpg", "1-b.jpg", "1-c.jpg"],
        kind: "meal",
        createdAt: oct1,
      },
      {
        id: expect.stringMatching(UUID),
        text: "Rain on the window",
        photos: [],
        createdAt: sep20,
      },
      {
        id: expect.stringMatching(UUID),
        text: "",
        photos: ["file:///var/mobile/tmp/old.jpg"],
        createdAt: aug2,
      },
      {
        id: expect.stringMatching(UUID),
        text: "Tango",
        photos: [],
        createdAt: jul9,
      },
    ]);
  });

  it("gives every moment a new UUID, with created_at and updated_at from the old date", async () => {
    const db = createTestDb();

    await importFromAsyncStorage(db, AsyncStorage, deps);

    const rows = db.select().from(moments).all();
    for (const row of rows) {
      expect(row.id).toMatch(UUID);
      expect(row.updatedAt).toBe(row.createdAt);
      expect(row.deletedAt).toBeNull();
    }
    expect(rows.map((r) => r.createdAt).sort()).toEqual(
      [oct1, sep20, aug2, jul9].sort(),
    );
  });

  it("leaves out a kind it doesn't know", async () => {
    const db = createTestDb();

    await importFromAsyncStorage(db, AsyncStorage, deps);

    const tango = db
      .select()
      .from(moments)
      .all()
      .find((m) => m.text === "Tango");
    expect(tango?.kind).toBeNull();
  });

  it("records the import in app_meta and sets the flag, keeping the old data as a backup", async () => {
    const db = createTestDb();

    await importFromAsyncStorage(db, AsyncStorage, deps);

    expect(db.select().from(appMeta).all()).toEqual([
      { key: "sqliteImported", value: String(deps.now()) },
    ]);
    expect(await AsyncStorage.getItem(FLAG)).toBe("true");
    expect(await AsyncStorage.getItem(OLD_KEY)).toBe(oldJson);
  });

  it("imports only once", async () => {
    const db = createTestDb();
    await importFromAsyncStorage(db, AsyncStorage, deps);

    await expect(importFromAsyncStorage(db, AsyncStorage, deps)).resolves.toBe(
      "skipped",
    );

    expect(counts(db)).toEqual({ moments: 4, photos: 4, meta: 1 });
  });

  it("does nothing when there is nothing to import", async () => {
    const db = createTestDb();
    await AsyncStorage.removeItem(OLD_KEY);

    await expect(importFromAsyncStorage(db, AsyncStorage, deps)).resolves.toBe(
      "skipped",
    );

    expect(counts(db)).toEqual({ moments: 0, photos: 0, meta: 0 });
    expect(await AsyncStorage.getItem(FLAG)).toBeNull();
  });

  describe("when it fails partway", () => {
    // The third id is the first moment's second photo, so that moment's row
    // is already written inside the transaction when it fails
    function failingOnThirdId() {
      let calls = 0;
      return {
        ...deps,
        newId: () => {
          calls += 1;
          if (calls === 3) throw new Error("disk full");
          return randomUUID();
        },
      };
    }

    it("writes nothing, sets no marker or flag, and leaves the old data unchanged", async () => {
      const db = createTestDb();

      await expect(
        importFromAsyncStorage(db, AsyncStorage, failingOnThirdId()),
      ).rejects.toThrow("disk full");

      expect(counts(db)).toEqual({ moments: 0, photos: 0, meta: 0 });
      expect(await AsyncStorage.getItem(FLAG)).toBeNull();
      expect(await AsyncStorage.getItem(OLD_KEY)).toBe(oldJson);
    });

    it("succeeds when tried again", async () => {
      const db = createTestDb();
      await importFromAsyncStorage(db, AsyncStorage, failingOnThirdId()).catch(
        () => {},
      );

      await expect(
        importFromAsyncStorage(db, AsyncStorage, deps),
      ).resolves.toBe("imported");

      expect(counts(db)).toEqual({ moments: 4, photos: 4, meta: 1 });
    });
  });

  it("fails without writing anything when the old data can't be read", async () => {
    const db = createTestDb();
    await AsyncStorage.setItem(OLD_KEY, "[{not json");

    await expect(
      importFromAsyncStorage(db, AsyncStorage, deps),
    ).rejects.toThrow();

    expect(counts(db)).toEqual({ moments: 0, photos: 0, meta: 0 });
    expect(await AsyncStorage.getItem(FLAG)).toBeNull();
  });

  describe("when the app stops after the commit, before the flag is set", () => {
    it("doesn't import again on the next launch, and sets the flag", async () => {
      const db = createTestDb();
      await importFromAsyncStorage(db, AsyncStorage, deps);
      await AsyncStorage.removeItem(FLAG);

      await expect(
        importFromAsyncStorage(db, AsyncStorage, deps),
      ).resolves.toBe("skipped");

      expect(counts(db)).toEqual({ moments: 4, photos: 4, meta: 1 });
      expect(await AsyncStorage.getItem(FLAG)).toBe("true");
    });

    it("still counts as imported when writing the flag fails", async () => {
      const db = createTestDb();
      const flakyStorage = {
        getItem: AsyncStorage.getItem,
        setItem: jest.fn().mockRejectedValue(new Error("storage full")),
      };

      await expect(
        importFromAsyncStorage(db, flakyStorage, deps),
      ).resolves.toBe("imported");

      expect(counts(db)).toEqual({ moments: 4, photos: 4, meta: 1 });
    });
  });
});
