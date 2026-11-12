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
      engine,
      transfer,
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
      // The file names of the first moment's photos that are here
      filesOf: () =>
        (listMoments(db)[0]?.photos ?? []).flatMap((p) =>
          p.fileName === null ? [] : [p.fileName],
        ),
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
    const { server, one, two } = twoDevices();
    one.keep("Picnic", "nature", ["p1.jpg", "p2.jpg"]);
    server.failNext("upload");
    server.failNext("upload");

    await one.sync();
    await two.sync();

    expect(one.filesOf()).toEqual(["p1.jpg", "p2.jpg"]);
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

describe("photos on two devices", () => {
  const downloadCalls = (server: FakeSyncServer) =>
    server.photoCalls
      .filter((c) => c.method === "downloadUrls")
      .map((c) => c.photoIds.length);

  it("brings photos kept on one to the other, in the same order, into its photos folder", async () => {
    const { one, two } = twoDevices();
    const picnic = one.keep("Picnic", "nature", ["p1.jpg", "p2.jpg"]);
    await one.sync();

    expect((await two.sync()).phase).toBe("idle");

    const ids = one.photoRows().map((p) => p.id);
    expect(two.moments()).toEqual([
      expect.objectContaining({
        id: picnic.id,
        photos: ids.map((id) => ({ id, fileName: `${id}.jpg` })),
      }),
    ]);
    expect(two.transfer.files.get(`${ids[0]}.jpg`)).toBe(
      "2048px jpeg of pixels of p1.jpg",
    );
    expect(two.photoRows().map((p) => p.uploadState)).toEqual([
      "uploaded",
      "uploaded",
    ]);
  });

  it("brings photos kept before the update across too", async () => {
    const { one, two } = twoDevices();
    // As the photo sync migration leaves them: local and pending
    one.keep("Old walk", "nature", ["1793-walk.jpg"]);

    await one.sync();
    await two.sync();

    expect(two.filesOf()).toHaveLength(1);
  });

  it("says it's downloading photos while it is", async () => {
    const { one, two } = twoDevices();
    one.keep("Picnic", "nature", ["p1.jpg"]);
    await one.sync();
    const activities: (string | undefined)[] = [];
    two.engine.subscribe((s) => {
      if (s.phase === "syncing") activities.push(s.activity);
    });

    await two.sync();

    expect(activities).toEqual([undefined, "downloading"]);
  });

  it("downloads each photo once", async () => {
    const { server, one, two } = twoDevices();
    one.keep("Picnic", "nature", ["p1.jpg"]);
    await one.sync();
    await two.sync();

    await two.sync();

    expect(downloadCalls(server)).toEqual([1]);
  });

  it("never asks for a photo whose upload hasn't completed, and gets it once it has", async () => {
    const { server, one, two } = twoDevices();
    one.keep("Picnic", "nature", ["p1.jpg"]);
    server.failNext("upload");
    await one.sync();

    await two.sync();

    expect(downloadCalls(server)).toEqual([]);
    expect(two.photoRows()[0]).toMatchObject({
      fileName: null,
      uploadState: "remote",
      uploadedAt: null,
    });

    await jest.advanceTimersByTimeAsync(5_000);
    await two.sync();

    expect(two.filesOf()).toHaveLength(1);
  });

  it("retries a failed download with backoff", async () => {
    const { server, one, two } = twoDevices();
    one.keep("Picnic", "nature", ["p1.jpg"]);
    await one.sync();
    server.failNext("download");

    expect((await two.sync()).phase).toBe("retrying");
    expect(two.filesOf()).toEqual([]);

    await jest.advanceTimersByTimeAsync(5_000);

    expect(two.filesOf()).toHaveLength(1);
  });

  it("logs a failed download in development, with the photo and error", async () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const { server, one, two } = twoDevices();
    one.keep("Picnic", "nature", ["p1.jpg"]);
    await one.sync();
    server.failNext("download");

    await two.sync();

    const [photo] = two.photoRows();
    expect(log).toHaveBeenCalledWith(
      `[sync] download failed for photo ${photo.id}: SyncError: unavailable`,
    );
    log.mockRestore();
  });

  it("keeps downloading the other photos when one fails", async () => {
    const { server, one, two } = twoDevices();
    one.keep("Picnic", "nature", ["p1.jpg", "p2.jpg", "p3.jpg"]);
    await one.sync();
    server.failNext("download");

    await two.sync();

    expect(two.filesOf()).toHaveLength(2);
  });

  it("asks for at most 50 download URLs at a time", async () => {
    const { server, one, two } = twoDevices();
    // Six moments of 10, the most a moment syncs (spec 009)
    for (let m = 0; m < 6; m++) {
      one.keep(
        `Album ${m}`,
        "friends",
        Array.from({ length: 10 }, (_, i) => `a${m}-${i}.jpg`),
      );
    }
    await one.sync();

    await two.sync();

    expect(downloadCalls(server)).toEqual([50, 10]);
    expect(two.photoRows().filter((p) => p.fileName !== null)).toHaveLength(60);
  });

  it("removes the photos of a deleted moment from the other device and the bucket", async () => {
    const { server, one, two } = twoDevices();
    const picnic = one.keep("Picnic", "nature", ["p1.jpg"]);
    await one.sync();
    await two.sync();
    const downloaded = two.filesOf();

    one.remove(picnic.id);
    await one.sync();
    await two.sync();

    expect(two.moments()).toEqual([]);
    expect(two.deleteFiles).toHaveBeenCalledWith(downloaded);
    expect(two.transfer.files.size).toBe(0);
    expect(server.objects.size).toBe(0);
  });
});
