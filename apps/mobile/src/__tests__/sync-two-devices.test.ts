import { asc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { MomentKind } from "@savor/shared";
import {
  deleteMoment,
  insertMoment,
  listMoments,
  updateMoment,
} from "@/db/moments-store";
import { momentPhotos } from "@/db/schema";
import { SyncEngine } from "@/sync/engine";
import { createTestDb } from "@/test-utils/db";
import { FakePhotoTransfer } from "@/test-utils/fake-photo-transfer";
import { FakeSyncServer } from "@/test-utils/fake-sync-server";

type PhotoRow = typeof momentPhotos.$inferSelect;

// Two phones signed in to the same account, syncing through one server
function twoDevices() {
  const server = new FakeSyncServer();
  let t = Date.UTC(2026, 10, 1, 9, 30);
  const now = () => (t += 1000);

  const device = () => {
    const db = createTestDb();
    const transfer = new FakePhotoTransfer(server);
    const deleteFiles = jest.fn(transfer.delete);
    const engine = new SyncEngine({
      db,
      api: server.api("user-a"),
      now,
      deleteFiles,
      transfer,
    });
    const deps = { newId: randomUUID, now };
    return {
      db,
      deleteFiles,
      sync: () => engine.sync().then(() => engine.status),
      keep: (text: string, kind?: MomentKind, photos: string[] = []) => {
        photos.forEach((p) => transfer.add(p));
        return insertMoment(db, { text, kind, photos }, deps);
      },
      edit: (id: string, text: string, kind?: MomentKind) =>
        updateMoment(db, id, { text, kind }, deps),
      remove: (id: string) => deleteMoment(db, id, deps),
      moments: () => listMoments(db),
      photoRows: () =>
        db
          .select()
          .from(momentPhotos)
          .orderBy(asc(momentPhotos.position))
          .all(),
    };
  };

  return { server, one: device(), two: device() };
}

// Failed syncs schedule retries; keep their timers out of real time
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe("two devices", () => {
  it("brings a moment kept on one to the other, with the same text, kind and date", async () => {
    const { one, two } = twoDevices();
    const ramen = one.keep("Ramen with Ana", "meal");

    await one.sync();
    await two.sync();

    expect(two.moments()).toEqual([
      {
        id: ramen.id,
        text: "Ramen with Ana",
        kind: "meal",
        photos: [],
        createdAt: ramen.createdAt,
      },
    ]);
  });

  it("pushes the moments a phone had before its first sync", async () => {
    const { one, two } = twoDevices();
    one.keep("Before signing in");
    one.keep("Also before");

    await one.sync();
    await two.sync();

    expect(two.moments().map((m) => m.text)).toEqual([
      "Also before",
      "Before signing in",
    ]);
  });

  it("brings edits to text and kind across", async () => {
    const { one, two } = twoDevices();
    const soup = one.keep("Soup", "meal");
    await one.sync();
    await two.sync();

    one.edit(soup.id, "Soup with Ana", "friends");
    await one.sync();
    await two.sync();

    expect(two.moments()[0]).toMatchObject({
      text: "Soup with Ana",
      kind: "friends",
    });
  });

  it("removes a moment deleted on the other device, with its local photo files", async () => {
    const { one, two } = twoDevices();
    const walk = two.keep("Walk", "nature", ["w1.jpg", "w2.jpg"]);
    await two.sync();
    await one.sync();

    one.remove(walk.id);
    await one.sync();
    await two.sync();

    expect(two.moments()).toEqual([]);
    expect(two.deleteFiles).toHaveBeenCalledWith(["w1.jpg", "w2.jpg"]);
  });

  it("deletes a moment on a device with an unsynced edit to it", async () => {
    const { server, one, two } = twoDevices();
    const walk = one.keep("Walk");
    await one.sync();
    await two.sync();

    one.remove(walk.id);
    two.edit(walk.id, "Walk by the river");
    await one.sync();
    await two.sync();

    expect(two.moments()).toEqual([]);
    expect(server.momentsOf("user-a")[0].deletedAt).not.toBeNull();
  });

  it("lets the edit that reaches the server last win", async () => {
    const { one, two } = twoDevices();
    const film = one.keep("Film");
    await one.sync();
    await two.sync();

    one.edit(film.id, "Film with Ana");
    two.edit(film.id, "Film night");
    await one.sync();
    await two.sync();
    await one.sync();

    expect(one.moments()[0].text).toBe("Film night");
    expect(two.moments()[0].text).toBe("Film night");
  });

  it("brings photo records across before their files, in the same order", async () => {
    const { one, two } = twoDevices();
    one.keep("Picnic", "nature", ["p1.jpg", "p2.jpg"]);

    await one.sync();
    await two.sync();

    expect(one.moments()[0].photos).toEqual(["p1.jpg", "p2.jpg"]);
    const sameRecord = ({ id, momentId, position }: PhotoRow) => ({
      id,
      momentId,
      position,
    });
    expect(two.photoRows().map(sameRecord)).toEqual(
      one.photoRows().map(sameRecord),
    );
    expect(two.photoRows().map((p) => [p.fileName, p.uploadState])).toEqual([
      [null, "remote"],
      [null, "remote"],
    ]);
  });

  it("sends moments kept while offline once the connection is back", async () => {
    const { server, one, two } = twoDevices();
    server.failNext("push");
    one.keep("Offline moment");

    const offline = await one.sync();
    expect(offline.phase).toBe("retrying");
    expect(server.momentsOf("user-a")).toEqual([]);

    await one.sync();
    await two.sync();
    expect(two.moments().map((m) => m.text)).toEqual(["Offline moment"]);
  });
});
