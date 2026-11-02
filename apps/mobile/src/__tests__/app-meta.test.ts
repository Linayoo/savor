import { getMeta, setMeta } from "@/db/app-meta";
import { createTestDb } from "@/test-utils/db";

describe("app meta", () => {
  it("has no owner and has pulled nothing on a new phone", () => {
    const db = createTestDb();

    expect(getMeta(db, "ownerUserId")).toBeNull();
    expect(getMeta(db, "lastPulledVersion")).toBe(0);
    expect(getMeta(db, "lastSyncedAt")).toBeNull();
  });

  it("stores and replaces values with their types", () => {
    const db = createTestDb();

    setMeta(db, "ownerUserId", "user-a");
    setMeta(db, "lastPulledVersion", 12);
    setMeta(db, "lastPulledVersion", 30);
    setMeta(db, "lastSyncedAt", 1_790_000_000_000);

    expect(getMeta(db, "ownerUserId")).toBe("user-a");
    expect(getMeta(db, "lastPulledVersion")).toBe(30);
    expect(getMeta(db, "lastSyncedAt")).toBe(1_790_000_000_000);
  });

  it("works inside a transaction, so it commits or rolls back with the data", () => {
    const db = createTestDb();

    expect(() =>
      db.transaction((tx) => {
        setMeta(tx, "lastPulledVersion", 5);
        throw new Error("page failed");
      }),
    ).toThrow("page failed");

    expect(getMeta(db, "lastPulledVersion")).toBe(0);
  });
});
