import { randomUUID } from "node:crypto";
import { momentPhotos, moments } from "@/db/schema";
import { deleteMoment, insertMoment, updateMoment } from "@/db/moments-store";
import type { AppDb } from "@/db/types";
import { SyncError } from "@/sync/api";
import { pushPending } from "@/sync/push";
import { createTestDb } from "@/test-utils/db";
import { FakeSyncServer } from "@/test-utils/fake-sync-server";

const start = Date.UTC(2026, 10, 1, 9, 30);

function setup() {
  const db = createTestDb();
  const server = new FakeSyncServer();
  let t = start;
  const deps = { newId: randomUUID, now: () => t };
  const keep = (
    text: string,
    kind?: "meal" | "film",
    photos: string[] = [],
  ) => {
    t += 1000;
    return insertMoment(db, { text, photos, kind }, deps);
  };
  const edit = (id: string, text: string, kind?: "meal" | "film") => {
    t += 1000;
    updateMoment(db, id, { text, kind }, deps);
  };
  const remove = (id: string) => {
    t += 1000;
    deleteMoment(db, id, deps);
  };
  return { db, server, api: server.api("user-a"), keep, edit, remove };
}

const pendingPhotos = (db: AppDb) =>
  db
    .select()
    .from(momentPhotos)
    .all()
    .filter((p) => p.pending === 1);

const pendingTexts = (db: AppDb) =>
  db
    .select()
    .from(moments)
    .all()
    .filter((m) => m.pending === 1)
    .map((m) => m.text);

describe("pushPending", () => {
  it("sends pending moments oldest change first, without photos, and clears pending", async () => {
    const { db, server, api, keep, edit } = setup();
    const ramen = keep("Ramen", "meal");
    keep("Film night", "film");
    edit(ramen.id, "Ramen with Ana", "meal");

    await pushPending(db, api);

    expect(server.pushes).toHaveLength(1);
    expect(server.pushes[0].input.photos).toEqual([]);
    expect(server.pushes[0].input.moments.map((m) => m.text)).toEqual([
      "Film night",
      "Ramen with Ana",
    ]);
    expect(server.momentsOf("user-a")).toContainEqual({
      id: ramen.id,
      text: "Ramen with Ana",
      kind: "meal",
      createdAt: ramen.createdAt,
      updatedAt: start + 3000,
      deletedAt: null,
    });
    expect(pendingTexts(db)).toEqual([]);
  });

  it("sends nothing when nothing is pending", async () => {
    const { db, server, api, keep } = setup();
    keep("Ramen");
    await pushPending(db, api);

    await pushPending(db, api);

    expect(server.pushes).toHaveLength(1);
  });

  it("sends a delete as a tombstone", async () => {
    const { db, server, api, keep, remove } = setup();
    const gone = keep("gone");
    await pushPending(db, api);
    remove(gone.id);

    await pushPending(db, api);

    expect(server.momentsOf("user-a")[0]).toMatchObject({
      id: gone.id,
      deletedAt: start + 2000,
    });
    expect(pendingTexts(db)).toEqual([]);
  });

  it("pushes more than 100 moments in batches of at most 100, and all arrive", async () => {
    const { db, server, api, keep } = setup();
    for (let i = 0; i < 250; i++) keep(`moment ${i}`);

    await pushPending(db, api);

    expect(server.pushes.map((p) => p.input.moments.length)).toEqual([
      100, 100, 50,
    ]);
    expect(server.momentsOf("user-a")).toHaveLength(250);
    expect(pendingTexts(db)).toEqual([]);
  });

  it("keeps a moment edited during the push pending, and pushes the edit next time", async () => {
    const { db, server, api, keep, edit } = setup();
    const soup = keep("Soup");
    const held = server.holdNextPush();

    const push = pushPending(db, api);
    await held.started;
    edit(soup.id, "Soup with Ana");
    held.release();
    await push;

    expect(server.momentsOf("user-a")[0].text).toBe("Soup");
    expect(pendingTexts(db)).toEqual(["Soup with Ana"]);

    await pushPending(db, api);

    expect(server.momentsOf("user-a")[0].text).toBe("Soup with Ana");
    expect(pendingTexts(db)).toEqual([]);
  });

  it("sends a moment edited during the push in the next sync, not again in this one", async () => {
    const { db, server, api, keep, edit } = setup();
    const moments = Array.from({ length: 150 }, (_, i) => keep(`m${i}`));
    const held = server.holdNextPush();

    const push = pushPending(db, api);
    await held.started;
    edit(moments[0].id, "edited");
    held.release();
    await push;

    expect(server.pushes).toHaveLength(2);
    expect(pendingTexts(db)).toEqual(["edited"]);
  });

  it("sends pending photo records after their moments, without file details, and clears pending", async () => {
    const { db, server, api, keep } = setup();
    const walk = keep("Walk", undefined, ["w1.jpg", "w2.jpg"]);
    const [first, second] = db.select().from(momentPhotos).all();

    await pushPending(db, api);

    expect(server.pushes).toHaveLength(1);
    expect(server.pushes[0].input.moments.map((m) => m.id)).toEqual([walk.id]);
    expect(server.pushes[0].input.photos).toHaveLength(2);
    expect(server.pushes[0].input.photos).toEqual(
      expect.arrayContaining(
        [first, second].map((p) => ({
          id: p.id,
          momentId: walk.id,
          position: p.position,
          createdAt: walk.createdAt,
          updatedAt: walk.createdAt,
          deletedAt: null,
        })),
      ),
    );
    expect(pendingPhotos(db)).toEqual([]);
  });

  it("sends a deleted moment's photos as tombstones", async () => {
    const { db, server, api, keep, remove } = setup();
    const walk = keep("Walk", undefined, ["w1.jpg"]);
    await pushPending(db, api);
    remove(walk.id);

    await pushPending(db, api);

    expect(server.photosOf("user-a")).toEqual([
      expect.objectContaining({ momentId: walk.id, deletedAt: start + 2000 }),
    ]);
    expect(pendingPhotos(db)).toEqual([]);
  });

  it("fits moments and photos in shared batches of at most 100, moments first", async () => {
    const { db, server, api, keep } = setup();
    for (let i = 0; i < 60; i++) keep(`moment ${i}`, undefined, [`${i}.jpg`]);

    await pushPending(db, api);

    expect(
      server.pushes.map(({ input }) => [
        input.moments.length,
        input.photos.length,
      ]),
    ).toEqual([
      [60, 40],
      [0, 20],
    ]);
    expect(server.photosOf("user-a")).toHaveLength(60);
    expect(pendingPhotos(db)).toEqual([]);
  });

  it("keeps a photo deleted during the push pending, and pushes the delete next time", async () => {
    const { db, server, api, keep, remove } = setup();
    const walk = keep("Walk", undefined, ["w1.jpg"]);
    const held = server.holdNextPush();

    const push = pushPending(db, api);
    await held.started;
    remove(walk.id);
    held.release();
    await push;

    expect(server.photosOf("user-a")[0].deletedAt).toBeNull();
    expect(pendingPhotos(db)).toHaveLength(1);

    await pushPending(db, api);

    expect(server.photosOf("user-a")[0].deletedAt).not.toBeNull();
    expect(pendingPhotos(db)).toEqual([]);
  });

  it("stops at a conflict, reports it and leaves the moments pending", async () => {
    const { db, server, api, keep } = setup();
    const ramen = keep("Ramen");
    server.seed("someone-else", {
      moments: [{ ...ramenChange(ramen.id), text: "theirs" }],
      photos: [],
    });

    await expect(pushPending(db, api)).rejects.toEqual(
      new SyncError("conflict"),
    );
    expect(pendingTexts(db)).toEqual(["Ramen"]);
  });

  it("keeps the batches the server accepted when a later one fails", async () => {
    const { db, server, keep } = setup();
    for (let i = 0; i < 150; i++) keep(`moment ${i}`);
    const failSecond = server.api("user-a");
    let calls = 0;
    const flaky = {
      ...failSecond,
      push: (input: Parameters<typeof failSecond.push>[0]) =>
        ++calls === 2
          ? Promise.reject(new SyncError("unavailable"))
          : failSecond.push(input),
    };

    await expect(pushPending(db, flaky)).rejects.toMatchObject({
      kind: "unavailable",
    });
    expect(server.momentsOf("user-a")).toHaveLength(100);
    expect(pendingTexts(db)).toHaveLength(50);
  });
});

function ramenChange(id: string) {
  return {
    id,
    text: "Ramen",
    kind: null,
    createdAt: start,
    updatedAt: start,
    deletedAt: null,
  };
}
