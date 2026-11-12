import type { MomentChange, PhotoChange } from "@savor/shared";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getMeta } from "@/db/app-meta";
import { insertMoment, listMoments, updateMoment } from "@/db/moments-store";
import { momentPhotos, moments } from "@/db/schema";
import type { AppDb } from "@/db/types";
import { pullChanges } from "@/sync/pull";
import { createTestDb } from "@/test-utils/db";
import { FakeSyncServer } from "@/test-utils/fake-sync-server";

const t = Date.UTC(2026, 10, 1, 9, 30);
const syncedAt = t + 60_000;

const change = (c: Partial<MomentChange> = {}): MomentChange => ({
  id: randomUUID(),
  text: "Ramen with Ana",
  kind: "meal",
  createdAt: t,
  updatedAt: t,
  deletedAt: null,
  ...c,
});

function setup() {
  const db = createTestDb();
  const server = new FakeSyncServer();
  const deleteFiles = jest.fn();
  const pull = (pageSize?: number) =>
    pullChanges(db, server.api("user-a"), {
      now: () => syncedAt,
      deleteFiles,
      pageSize,
    });
  const seed = (...changes: MomentChange[]) =>
    server.seed("user-a", { moments: changes, photos: [] });
  return { db, server, deleteFiles, pull, seed };
}

const row = (db: AppDb, id: string) =>
  db.select().from(moments).where(eq(moments.id, id)).get();

// A moment this phone kept itself, with photos, already pushed
function keepSynced(db: AppDb, photos: string[] = []) {
  const kept = insertMoment(
    db,
    { text: "Walk", photos, kind: "nature" },
    { newId: randomUUID, now: () => t },
  );
  db.update(moments).set({ pending: 0 }).run();
  return kept;
}

describe("pullChanges", () => {
  it("adds a moment kept on another device, not pending", async () => {
    const { db, pull, seed } = setup();
    const ramen = change();
    seed(ramen);

    await pull();

    expect(row(db, ramen.id)).toEqual({ ...ramen, pending: 0 });
    expect(listMoments(db)).toEqual([
      {
        id: ramen.id,
        text: "Ramen with Ana",
        kind: "meal",
        photos: [],
        createdAt: t,
      },
    ]);
  });

  it("replaces a moment without local changes", async () => {
    const { db, pull, seed } = setup();
    const walk = keepSynced(db);
    const edited = change({
      id: walk.id,
      text: "Long walk",
      kind: "friends",
      updatedAt: t + 5000,
    });
    seed(edited);

    await pull();

    expect(row(db, walk.id)).toEqual({ ...edited, pending: 0 });
  });

  it("skips a moment with local changes, which wins at the next push", async () => {
    const { db, pull, seed } = setup();
    const walk = keepSynced(db);
    updateMoment(
      db,
      walk.id,
      { text: "Walk by the river", kind: "nature" },
      { newId: randomUUID, now: () => t + 9000 },
    );
    seed(change({ id: walk.id, text: "Long walk", updatedAt: t + 5000 }));

    await pull();

    expect(row(db, walk.id)).toMatchObject({
      text: "Walk by the river",
      pending: 1,
    });
  });

  it("applies a delete even over local changes, with the moment's photos and files", async () => {
    const { db, deleteFiles, pull, seed } = setup();
    const walk = keepSynced(db, ["w1.jpg", "w2.jpg"]);
    updateMoment(
      db,
      walk.id,
      { text: "Walk by the river" },
      { newId: randomUUID, now: () => t + 9000 },
    );
    seed(
      change({
        id: walk.id,
        text: "Walk",
        kind: "nature",
        updatedAt: t + 5000,
        deletedAt: t + 5000,
      }),
    );

    await pull();

    expect(row(db, walk.id)).toMatchObject({
      text: "",
      kind: null,
      deletedAt: t + 5000,
      pending: 0,
    });
    expect(listMoments(db)).toEqual([]);
    for (const photo of db.select().from(momentPhotos).all()) {
      expect(photo.deletedAt).toBe(t + 5000);
    }
    expect(deleteFiles).toHaveBeenCalledWith(["w1.jpg", "w2.jpg"]);
  });

  it("stores a moment deleted on another device with no text or kind", async () => {
    const { db, pull, seed } = setup();
    // As a server from before deletes cleared the words would send it
    const gone = change({ updatedAt: t + 5000, deletedAt: t + 5000 });
    seed(gone);

    await pull();

    expect(row(db, gone.id)).toEqual({
      ...gone,
      text: "",
      kind: null,
      pending: 0,
    });
  });

  it("deletes the files of a moment without local changes too", async () => {
    const { db, deleteFiles, pull, seed } = setup();
    const walk = keepSynced(db, ["w1.jpg"]);
    seed(change({ id: walk.id, updatedAt: t + 5000, deletedAt: t + 5000 }));

    await pull();

    expect(row(db, walk.id)?.deletedAt).toBe(t + 5000);
    expect(deleteFiles).toHaveBeenCalledWith(["w1.jpg"]);
  });

  it("applies every page and ends at the highest version", async () => {
    const { db, server, pull, seed } = setup();
    seed(...Array.from({ length: 450 }, (_, i) => change({ text: `m${i}` })));

    await pull(200);

    expect(server.pulls.map((p) => p.sinceVersion)).toEqual([0, 200, 400]);
    expect(listMoments(db)).toHaveLength(450);
    expect(getMeta(db, "lastPulledVersion")).toBe(450);
  });

  it("asks only for changes after the last pulled version", async () => {
    const { db, server, pull, seed } = setup();
    seed(change(), change());
    await pull();
    seed(change());

    await pull();

    expect(server.pulls.at(-1)?.sinceVersion).toBe(2);
    expect(getMeta(db, "lastPulledVersion")).toBe(3);
  });

  it("saves none of a page that fails to apply, nor its version, and applies it next time", async () => {
    const { db, deleteFiles, pull, seed } = setup();
    const walk = keepSynced(db, ["w1.jpg"]);
    const [first, bad] = [change({ text: "first" }), change({ text: "bad" })];
    seed(
      change({ id: walk.id, updatedAt: t + 5000, deletedAt: t + 5000 }),
      first,
      bad,
    );
    // Fails partway through the page, after earlier rows were written
    db.run(
      sql.raw(
        `create trigger fail_bad before insert on moments when new.id = '${bad.id}' begin select raise(abort, 'bad row'); end`,
      ),
    );

    await expect(pull()).rejects.toThrow("bad row");

    expect(row(db, first.id)).toBeUndefined();
    expect(row(db, walk.id)?.deletedAt).toBeNull();
    expect(getMeta(db, "lastPulledVersion")).toBe(0);
    expect(getMeta(db, "lastSyncedAt")).toBeNull();
    expect(deleteFiles).not.toHaveBeenCalled();

    db.run(sql.raw("drop trigger fail_bad"));
    await pull();

    expect(
      listMoments(db)
        .map((m) => m.text)
        .sort(),
    ).toEqual(["bad", "first"]);
    expect(getMeta(db, "lastPulledVersion")).toBe(3);
    expect(deleteFiles).toHaveBeenCalledWith(["w1.jpg"]);
  });

  it("keeps the pages before a failed call", async () => {
    const { db, server, seed } = setup();
    seed(...Array.from({ length: 5 }, () => change()));
    const api = server.api("user-a");
    let calls = 0;
    const flaky = {
      ...api,
      pull: (input: Parameters<typeof api.pull>[0]) =>
        ++calls === 2 ? Promise.reject(new Error("offline")) : api.pull(input),
    };

    await expect(
      pullChanges(db, flaky, {
        now: () => syncedAt,
        deleteFiles: jest.fn(),
        pageSize: 2,
      }),
    ).rejects.toThrow("offline");

    expect(listMoments(db)).toHaveLength(2);
    expect(getMeta(db, "lastPulledVersion")).toBe(2);
  });

  describe("photo records", () => {
    const photoChange = (c: Partial<PhotoChange> = {}): PhotoChange => ({
      id: randomUUID(),
      momentId: randomUUID(),
      position: 0,
      createdAt: t,
      updatedAt: t,
      deletedAt: null,
      ...c,
    });
    const photoRow = (db: AppDb, id: string) =>
      db.select().from(momentPhotos).where(eq(momentPhotos.id, id)).get();
    // A photo this phone kept itself, already pushed
    const keptPhoto = (db: AppDb) => {
      const walk = keepSynced(db, ["w1.jpg"]);
      db.update(momentPhotos).set({ pending: 0 }).run();
      const [photo] = db.select().from(momentPhotos).all();
      return { walk, photo };
    };

    it("adds a photo from another device as remote, with no file, and when it was uploaded", async () => {
      const { db, server, pull } = setup();
      const walk = change();
      const photo = photoChange({ momentId: walk.id, position: 1 });
      server.seed("user-a", { moments: [walk], photos: [photo] });
      server.markUploaded("user-a", photo.id, t + 7000);

      expect(await pull()).toEqual({ changed: true });

      expect(photoRow(db, photo.id)).toEqual({
        ...photo,
        fileName: null,
        pending: 0,
        uploadState: "remote",
        uploadedAt: t + 7000,
      });
    });

    it("adds a photo that isn't uploaded yet with no uploadedAt", async () => {
      const { db, server, pull } = setup();
      const photo = photoChange();
      server.seed("user-a", { moments: [], photos: [photo] });

      await pull();

      expect(photoRow(db, photo.id)).toMatchObject({
        uploadState: "remote",
        uploadedAt: null,
      });
    });

    it("stores a photo that arrives before its moment", async () => {
      const { db, server, pull, seed } = setup();
      const walk = change();
      const photo = photoChange({ momentId: walk.id });
      server.seed("user-a", { moments: [walk], photos: [photo] });
      // The moment's edit moves it after the photo
      seed({ ...walk, text: "Long walk", updatedAt: t + 5000 });

      await pull(1);

      expect(photoRow(db, photo.id)?.momentId).toBe(walk.id);
      expect(row(db, walk.id)?.text).toBe("Long walk");
    });

    it("copies uploadedAt to a photo kept here, keeping its file and state", async () => {
      const { db, server, pull } = setup();
      const { walk, photo } = keptPhoto(db);
      server.seed("user-a", {
        moments: [change({ id: walk.id })],
        photos: [photoChange({ id: photo.id, momentId: walk.id })],
      });
      server.markUploaded("user-a", photo.id, t + 7000);

      await pull();

      expect(photoRow(db, photo.id)).toMatchObject({
        fileName: "w1.jpg",
        uploadState: "local",
        uploadedAt: t + 7000,
        pending: 0,
      });
    });

    it("skips a photo with local changes, which win at the next push", async () => {
      const { db, server, pull } = setup();
      const { walk, photo } = keptPhoto(db);
      db.update(momentPhotos).set({ pending: 1 }).run();
      server.seed("user-a", {
        moments: [],
        photos: [
          photoChange({
            id: photo.id,
            momentId: walk.id,
            position: 3,
            updatedAt: t + 5000,
          }),
        ],
      });

      await pull();

      expect(photoRow(db, photo.id)).toMatchObject({
        position: 0,
        pending: 1,
      });
    });

    it("keeps a photo deleted here deleted, as the server does", async () => {
      const { db, server, pull, seed } = setup();
      const { walk, photo } = keptPhoto(db);
      seed(change({ id: walk.id, updatedAt: t + 5000, deletedAt: t + 5000 }));
      server.seed("user-a", {
        moments: [],
        photos: [photoChange({ id: photo.id, momentId: walk.id })],
      });
      server.markUploaded("user-a", photo.id, t + 7000);

      await pull();

      expect(photoRow(db, photo.id)?.deletedAt).toBe(t + 5000);
    });

    it("applies a photo delete even over local changes, and deletes its file after", async () => {
      const { db, server, deleteFiles, pull } = setup();
      const { walk, photo } = keptPhoto(db);
      db.update(momentPhotos).set({ pending: 1 }).run();
      server.seed("user-a", {
        moments: [],
        photos: [
          photoChange({
            id: photo.id,
            momentId: walk.id,
            updatedAt: t + 5000,
            deletedAt: t + 5000,
          }),
        ],
      });

      await pull();

      expect(photoRow(db, photo.id)).toMatchObject({
        fileName: "w1.jpg",
        deletedAt: t + 5000,
        pending: 0,
      });
      expect(listMoments(db)[0].photos).toEqual([]);
      expect(deleteFiles).toHaveBeenCalledWith(["w1.jpg"]);
    });

    it("deletes no file for a photo that never arrived", async () => {
      const { server, deleteFiles, pull } = setup();
      const photo = photoChange();
      server.seed("user-a", { moments: [], photos: [photo] });
      await pull();
      server.seed("user-a", {
        moments: [],
        photos: [{ ...photo, updatedAt: t + 5000, deletedAt: t + 5000 }],
      });

      await pull();

      expect(deleteFiles).not.toHaveBeenCalled();
    });
  });

  it("records when it finished, and whether anything changed", async () => {
    const { db, pull, seed } = setup();

    expect(await pull()).toEqual({ changed: false });
    seed(change());
    expect(await pull()).toEqual({ changed: true });
    expect(getMeta(db, "lastSyncedAt")).toBe(syncedAt);
  });
});
