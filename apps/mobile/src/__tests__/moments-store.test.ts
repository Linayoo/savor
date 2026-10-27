import { randomUUID } from "node:crypto";
import { momentPhotos, moments } from "@/db/schema";
import {
  deleteMoment,
  insertMoment,
  listMoments,
  updateMoment,
} from "@/db/moments-store";
import { createTestDb } from "@/test-utils/db";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// A clock the test moves by hand
function clock(start: number) {
  let t = start;
  return {
    now: () => t,
    tick: (ms = 1000) => (t += ms),
  };
}

function setup() {
  const db = createTestDb();
  const time = clock(Date.UTC(2026, 9, 1, 9, 30));
  const deps = { newId: randomUUID, now: time.now };
  return { db, time, deps };
}

describe("insertMoment", () => {
  it("gives the moment a UUID and sets created_at and updated_at", () => {
    const { db, time, deps } = setup();

    const moment = insertMoment(db, { text: "Ramen", photos: [] }, deps);

    expect(moment.id).toMatch(UUID);
    expect(db.select().from(moments).all()).toEqual([
      {
        id: moment.id,
        text: "Ramen",
        kind: null,
        createdAt: time.now(),
        updatedAt: time.now(),
        deletedAt: null,
      },
    ]);
  });

  it("uses randomUUID by default, so moments kept in the same millisecond differ", () => {
    const { db } = setup();

    const a = insertMoment(db, { text: "a", photos: [] });
    const b = insertMoment(db, { text: "b", photos: [] });

    expect(a.id).toMatch(UUID);
    expect(b.id).toMatch(UUID);
    expect(a.id).not.toBe(b.id);
  });

  it("keeps the kind and the photos in order", () => {
    const { db, deps } = setup();

    insertMoment(
      db,
      { text: "Walk", photos: ["1-a.jpg", "1-b.jpg"], kind: "nature" },
      deps,
    );

    expect(listMoments(db)).toEqual([
      expect.objectContaining({
        text: "Walk",
        kind: "nature",
        photos: ["1-a.jpg", "1-b.jpg"],
      }),
    ]);
    expect(
      db
        .select({
          fileName: momentPhotos.fileName,
          position: momentPhotos.position,
        })
        .from(momentPhotos)
        .all(),
    ).toEqual([
      { fileName: "1-a.jpg", position: 0 },
      { fileName: "1-b.jpg", position: 1 },
    ]);
  });
});

describe("listMoments", () => {
  it("lists moments newest first, in the Moment shape the screens use", () => {
    const { db, time, deps } = setup();
    const older = insertMoment(db, { text: "older", photos: [] }, deps);
    time.tick();
    const newer = insertMoment(
      db,
      { text: "newer", photos: ["n.jpg"], kind: "meal" },
      deps,
    );

    expect(listMoments(db)).toEqual([
      {
        id: newer.id,
        text: "newer",
        photos: ["n.jpg"],
        kind: "meal",
        createdAt: newer.createdAt,
      },
      { id: older.id, text: "older", photos: [], createdAt: older.createdAt },
    ]);
  });
});

describe("updateMoment", () => {
  it("changes text and kind, moves updated_at and keeps created_at", () => {
    const { db, time, deps } = setup();
    const moment = insertMoment(db, { text: "Soup", photos: [] }, deps);
    const createdAt = time.now();
    time.tick();

    updateMoment(
      db,
      moment.id,
      { text: "Soup with Ana", kind: "friends" },
      deps,
    );

    const [row] = db.select().from(moments).all();
    expect(row).toMatchObject({
      text: "Soup with Ana",
      kind: "friends",
      createdAt,
      updatedAt: time.now(),
    });
  });

  it("clears the kind when none is given", () => {
    const { db, deps } = setup();
    const moment = insertMoment(
      db,
      { text: "Soup", photos: [], kind: "meal" },
      deps,
    );

    updateMoment(db, moment.id, { text: "Soup" }, deps);

    expect(listMoments(db)[0]).not.toHaveProperty("kind");
  });

  it("leaves the photos alone", () => {
    const { db, deps } = setup();
    const moment = insertMoment(
      db,
      { text: "Walk", photos: ["a.jpg", "b.jpg"] },
      deps,
    );

    updateMoment(db, moment.id, { text: "Long walk", kind: "nature" }, deps);

    expect(listMoments(db)[0].photos).toEqual(["a.jpg", "b.jpg"]);
  });
});

describe("deleteMoment", () => {
  it("hides the moment but keeps its rows, marked as deleted", () => {
    const { db, time, deps } = setup();
    const kept = insertMoment(db, { text: "kept", photos: [] }, deps);
    const gone = insertMoment(
      db,
      { text: "gone", photos: ["g1.jpg", "g2.jpg"] },
      deps,
    );
    time.tick();

    deleteMoment(db, gone.id, deps);

    expect(listMoments(db).map((m) => m.id)).toEqual([kept.id]);
    expect(
      db
        .select()
        .from(moments)
        .all()
        .find((m) => m.id === gone.id),
    ).toMatchObject({ deletedAt: time.now(), updatedAt: time.now() });
    const photoRows = db.select().from(momentPhotos).all();
    expect(photoRows).toHaveLength(2);
    for (const photo of photoRows) {
      expect(photo).toMatchObject({
        deletedAt: time.now(),
        updatedAt: time.now(),
      });
    }
  });

  it("returns the photo file names so they can be removed from the phone", () => {
    const { db, deps } = setup();
    const moment = insertMoment(
      db,
      { text: "gone", photos: ["g1.jpg", "g2.jpg"] },
      deps,
    );

    expect(deleteMoment(db, moment.id, deps)).toEqual(["g1.jpg", "g2.jpg"]);
  });
});
