import { getMeta } from "@/db/app-meta";
import { claimPhone } from "@/sync/ownership";
import { createTestDb, seedMoments } from "@/test-utils/db";

describe("claimPhone", () => {
  it("makes a phone without an owner the account's, with the moments on it", () => {
    const db = createTestDb();
    seedMoments(db, [{ text: "Before signing in", createdAt: 1 }]);

    expect(claimPhone(db, "user-a")).toBe("claimed");
    expect(getMeta(db, "ownerUserId")).toBe("user-a");
  });

  it("lets the owner sign in again", () => {
    const db = createTestDb();
    claimPhone(db, "user-a");

    expect(claimPhone(db, "user-a")).toBe("owner");
    expect(getMeta(db, "ownerUserId")).toBe("user-a");
  });

  it("refuses another account and changes nothing", () => {
    const db = createTestDb();
    claimPhone(db, "user-a");

    expect(claimPhone(db, "user-b")).toBe("otherAccount");
    expect(getMeta(db, "ownerUserId")).toBe("user-a");
  });
});
