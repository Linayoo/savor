import { eq } from "drizzle-orm";
import { getMeta, setMeta } from "@/db/app-meta";
import { clearAccountData } from "@/db/clear-account";
import { listLetters, replaceLetters } from "@/db/letters-store";
import { listMoments } from "@/db/moments-store";
import { appMeta } from "@/db/schema";
import { createTestDb, seedMoments } from "@/test-utils/db";

// What a deleted account leaves on a phone: nothing (spec 010)

function setup() {
  const db = createTestDb();
  seedMoments(db, [
    { text: "Ramen with Ana", photos: ["1-a.jpg", "1-b.jpg"], createdAt: 1 },
    { text: "Rain on the window", createdAt: 2 },
  ]);
  replaceLetters(db, [
    { id: "l-1", month: "2026-10", body: "Dear you", createdAt: 3 },
  ]);
  setMeta(db, "ownerUserId", "sub-ana");
  setMeta(db, "lastPulledVersion", 12);
  setMeta(db, "lastSyncedAt", 4);
  setMeta(db, "photosWaitingForSpace", true);
  return db;
}

describe("clearAccountData", () => {
  it("deletes the photo files, then the moments, photos, letters and app meta", () => {
    const db = setup();
    let momentsWhenFilesWent = -1;
    const deleteFiles = jest.fn(() => {
      momentsWhenFilesWent = listMoments(db).length;
    });

    clearAccountData(db, deleteFiles);

    expect(deleteFiles).toHaveBeenCalledWith(
      expect.arrayContaining(["1-a.jpg", "1-b.jpg"]),
    );
    // Files first: if the app stops in between, the next clearing finds
    // the rows and deletes them, rather than files nobody points to
    expect(momentsWhenFilesWent).toBe(2);
    expect(listMoments(db)).toEqual([]);
    expect(listLetters(db)).toEqual([]);
    expect(getMeta(db, "ownerUserId")).toBeNull();
    expect(getMeta(db, "lastPulledVersion")).toBe(0);
    expect(getMeta(db, "lastSyncedAt")).toBeNull();
    expect(getMeta(db, "photosWaitingForSpace")).toBe(false);
  });

  it("keeps the one-time import's marker, so old moments aren't imported again", () => {
    const db = setup();
    db.insert(appMeta).values({ key: "sqliteImported", value: "1" }).run();

    clearAccountData(db, jest.fn());

    expect(
      db.select().from(appMeta).where(eq(appMeta.key, "sqliteImported")).get(),
    ).toBeDefined();
  });

  it("is safe to repeat", () => {
    const db = setup();
    const deleteFiles = jest.fn();
    clearAccountData(db, deleteFiles);

    clearAccountData(db, deleteFiles);

    expect(deleteFiles).toHaveBeenLastCalledWith([]);
    expect(listMoments(db)).toEqual([]);
  });
});
