import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { deleteMoment, insertMoment, listMoments } from "@/db/moments-store";
import { momentPhotos } from "@/db/schema";
import { SyncEngine } from "@/sync/engine";
import { createTestDb, photosNamed } from "@/test-utils/db";
import { FakePhotoTransfer } from "@/test-utils/fake-photo-transfer";
import { FakeSyncServer, photoKey } from "@/test-utils/fake-sync-server";

const t = Date.UTC(2026, 10, 1, 9, 30);

function setup() {
  const db = createTestDb();
  const server = new FakeSyncServer();
  const transfer = new FakePhotoTransfer(server);
  const engine = new SyncEngine({
    db,
    api: server.api("user-a"),
    now: () => Date.now(),
    deleteFiles: transfer.delete,
    transfer,
  });
  const keep = (text: string, photos: string[]) => {
    photos.forEach((p) => transfer.add(p));
    const moment = insertMoment(
      db,
      { text, photos },
      { newId: randomUUID, now: () => t },
    );
    const ids = db
      .select({ id: momentPhotos.id, fileName: momentPhotos.fileName })
      .from(momentPhotos)
      .where(eq(momentPhotos.momentId, moment.id))
      .all();
    const idOf = (fileName: string) =>
      ids.find((p) => p.fileName === fileName)!.id;
    return { moment, idOf };
  };
  const photo = (id: string) =>
    db.select().from(momentPhotos).where(eq(momentPhotos.id, id)).get()!;
  const sync = () => engine.sync().then(() => engine.status);
  const calls = (method: string) =>
    server.photoCalls
      .filter((c) => c.method === method)
      .flatMap((c) => c.photoIds);
  return { db, server, transfer, engine, keep, photo, sync, calls };
}

beforeEach(() => {
  jest.useFakeTimers({ now: t });
});
afterEach(() => jest.useRealTimers());

describe("the upload queue", () => {
  it("uploads a copy of a kept photo once its record is accepted, then marks it uploaded", async () => {
    const { server, transfer, keep, photo, sync } = setup();
    const { idOf } = keep("Walk", ["w1.jpg"]);

    expect((await sync()).phase).toBe("idle");

    const id = idOf("w1.jpg");
    expect(server.objects.get(photoKey("user-a", id))).toBe(
      "2048px jpeg of pixels of w1.jpg",
    );
    expect(server.photosOf("user-a")[0].uploadedAt).toEqual(expect.any(Number));
    expect(photo(id)).toMatchObject({
      fileName: "w1.jpg",
      uploadState: "uploaded",
    });
    // The original stays; the upload copy is gone
    expect(transfer.files.has("w1.jpg")).toBe(true);
    expect(transfer.copies.size).toBe(0);
  });

  it("uploads each photo once", async () => {
    const { keep, sync, calls } = setup();
    const { idOf } = keep("Walk", ["w1.jpg"]);
    await sync();

    await sync();

    expect(calls("createUpload")).toEqual([idOf("w1.jpg")]);
  });

  it("waits until the server has the photo's record", async () => {
    const { server, keep, photo, sync, calls } = setup();
    const { idOf } = keep("Walk", ["w1.jpg"]);
    server.failNext("push");

    await sync();

    expect(calls("createUpload")).toEqual([]);
    expect(photo(idOf("w1.jpg")).uploadState).toBe("local");

    await jest.advanceTimersByTimeAsync(5_000);

    expect(photo(idOf("w1.jpg")).uploadState).toBe("uploaded");
  });

  it("removes a photo whose file is missing from its moment everywhere, and never tries it again", async () => {
    const { db, server, transfer, keep, sync, calls } = setup();
    const { moment, idOf } = keep("Walk", ["gone.jpg", "w2.jpg"]);
    transfer.files.delete("gone.jpg");

    expect((await sync()).phase).toBe("idle");

    expect(listMoments(db)).toEqual([
      expect.objectContaining({ id: moment.id, photos: photosNamed("w2.jpg") }),
    ]);
    expect(server.photosOf("user-a")).toContainEqual(
      expect.objectContaining({ id: idOf("gone.jpg"), deletedAt: t }),
    );
    expect(server.momentsOf("user-a")[0].deletedAt).toBeNull();

    await sync();

    expect(calls("createUpload")).toEqual([idOf("w2.jpg")]);
  });

  it("retries a failed upload with backoff, while the moment itself has synced", async () => {
    const { server, transfer, keep, photo, sync } = setup();
    const { idOf } = keep("Walk", ["w1.jpg"]);
    server.failNext("upload");

    expect((await sync()).phase).toBe("retrying");
    expect(server.momentsOf("user-a").map((m) => m.text)).toEqual(["Walk"]);
    expect(photo(idOf("w1.jpg")).uploadState).toBe("local");
    expect(transfer.copies.size).toBe(0);

    await jest.advanceTimersByTimeAsync(5_000);

    expect(photo(idOf("w1.jpg")).uploadState).toBe("uploaded");
  });

  it("retries when the upload form is refused, as an expired one is", async () => {
    const { server, keep, photo, sync, calls } = setup();
    const { idOf } = keep("Walk", ["w1.jpg"]);
    server.failNext("upload", "unavailable");
    await sync();

    await jest.advanceTimersByTimeAsync(5_000);

    // A new form each time
    expect(calls("createUpload")).toEqual([idOf("w1.jpg"), idOf("w1.jpg")]);
    expect(photo(idOf("w1.jpg")).uploadState).toBe("uploaded");
  });

  it("keeps uploading the other photos when one fails", async () => {
    const { server, keep, photo, sync } = setup();
    const { idOf } = keep("Walk", ["w1.jpg", "w2.jpg", "w3.jpg", "w4.jpg"]);
    server.failNext("confirmUpload");

    expect((await sync()).phase).toBe("retrying");

    const states = ["w1.jpg", "w2.jpg", "w3.jpg", "w4.jpg"].map(
      (f) => photo(idOf(f)).uploadState,
    );
    expect(states.filter((s) => s === "uploaded")).toHaveLength(3);
  });

  it("skips a photo the server no longer has, without failing the sync", async () => {
    const { server, keep, photo, sync } = setup();
    const { idOf } = keep("Walk", ["w1.jpg"]);
    server.failNext("createUpload", "notFound");

    expect((await sync()).phase).toBe("idle");
    expect(photo(idOf("w1.jpg")).uploadState).toBe("local");
  });

  it("doesn't upload the photos of a deleted moment", async () => {
    const { db, server, keep, sync, calls } = setup();
    const { moment } = keep("Walk", ["w1.jpg"]);
    server.failNext("createUpload");
    await sync();
    deleteMoment(db, moment.id);

    await jest.advanceTimersByTimeAsync(5_000);

    expect(calls("createUpload")).toHaveLength(1);
  });
});
