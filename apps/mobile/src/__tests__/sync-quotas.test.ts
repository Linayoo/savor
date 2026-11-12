import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getMeta } from "@/db/app-meta";
import { deleteMoment, insertMoment, updateMoment } from "@/db/moments-store";
import { momentPhotos, moments } from "@/db/schema";
import { SyncEngine } from "@/sync/engine";
import { syncLine } from "@/sync/sync-line";
import { createTestDb } from "@/test-utils/db";
import { FakePhotoTransfer } from "@/test-utils/fake-photo-transfer";
import { FakeSyncServer } from "@/test-utils/fake-sync-server";

// What the phone does when the server refuses for a quota (spec 009):
// nothing is lost, deletes still go through, and the rest waits.

const t = Date.UTC(2026, 10, 12, 9, 30);
const longestRetry = 600_000;

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
  const keep = (text: string, photos: string[] = []) => {
    photos.forEach((p) => transfer.add(p));
    return insertMoment(
      db,
      { text, photos },
      { newId: randomUUID, now: () => Date.now() },
    );
  };
  const sync = () => engine.sync().then(() => engine.status);
  const row = (id: string) =>
    db.select().from(moments).where(eq(moments.id, id)).get()!;
  const photosOf = (momentId: string) =>
    db
      .select()
      .from(momentPhotos)
      .where(eq(momentPhotos.momentId, momentId))
      .orderBy(momentPhotos.position)
      .all();
  return { db, server, engine, keep, sync, row, photosOf };
}

beforeEach(() => {
  jest.useFakeTimers({ now: t });
});
afterEach(() => jest.useRealTimers());

describe("more than 10 photos in a moment kept before the limit", () => {
  it("syncs the moment and its first 10 photos; the rest stay on this phone", async () => {
    const { server, keep, sync, photosOf } = setup();
    const names = Array.from({ length: 12 }, (_, i) => `p${i}.jpg`);
    const moment = keep("Wedding", names);

    expect((await sync()).phase).toBe("idle");

    const local = photosOf(moment.id);
    expect(
      server
        .photosOf("user-a")
        .map((p) => p.position)
        .sort((a, b) => a - b),
    ).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(local.slice(0, 10).every((p) => p.uploadState === "uploaded")).toBe(
      true,
    );
    expect(local.slice(10)).toEqual([
      expect.objectContaining({ fileName: "p10.jpg", uploadState: "local" }),
      expect.objectContaining({ fileName: "p11.jpg", uploadState: "local" }),
    ]);
  });
});

describe("new moments per day", () => {
  it("still pushes deletes; new moments and edits wait, and the line says so", async () => {
    const { db, server, keep, sync, row } = setup();
    const gone = keep("Gone soon");
    const edited = keep("Soup");
    await sync();
    deleteMoment(db, gone.id);
    updateMoment(db, edited.id, { text: "Soup with Ana" });
    const waiting = keep("Ramen with Ana");
    server.failNext("push", "overQuota", "momentsPerDay");

    const status = await sync();

    expect(status).toMatchObject({
      phase: "waiting",
      quota: "momentsPerDay",
    });
    expect(syncLine(status, true, Date.now())).toBe(
      "Some changes will sync tomorrow",
    );
    const onServer = new Map(server.momentsOf("user-a").map((m) => [m.id, m]));
    expect(onServer.get(gone.id)?.deletedAt).toEqual(expect.any(Number));
    expect(onServer.get(edited.id)?.text).toBe("Soup");
    expect(onServer.has(waiting.id)).toBe(false);
    expect(row(waiting.id).pending).toBe(1);
    expect(row(edited.id).pending).toBe(1);
  });

  it("pulls changes from other devices while new moments wait", async () => {
    const { server, keep, sync } = setup();
    keep("Ramen with Ana");
    server.seed("user-a", {
      moments: [
        {
          id: randomUUID(),
          text: "From the other phone",
          kind: null,
          createdAt: t,
          updatedAt: t,
          deletedAt: null,
        },
      ],
      photos: [],
    });
    server.failNext("push", "overQuota", "momentsPerDay");

    await sync();

    expect(server.pulls.length).toBeGreaterThan(0);
  });

  it("tries again after the longest retry delay, and syncs once the server takes it", async () => {
    const { server, keep, sync, row } = setup();
    const waiting = keep("Ramen with Ana");
    server.failNext("push", "overQuota", "momentsPerDay");
    await sync();

    await jest.advanceTimersByTimeAsync(longestRetry - 1);
    expect(row(waiting.id).pending).toBe(1);
    await jest.advanceTimersByTimeAsync(1);

    expect(row(waiting.id).pending).toBe(0);
  });
});

describe("photo storage", () => {
  it("syncs the moment, keeps the photo on this phone, and notes it's waiting for space", async () => {
    const { db, server, keep, sync, photosOf } = setup();
    const moment = keep("Walk", ["w1.jpg"]);
    server.failNext("createUpload", "overQuota", "storage");

    expect((await sync()).phase).toBe("idle");

    expect(server.momentsOf("user-a").map((m) => m.id)).toEqual([moment.id]);
    expect(photosOf(moment.id)[0]).toMatchObject({
      fileName: "w1.jpg",
      uploadState: "local",
    });
    expect(getMeta(db, "photosWaitingForSpace")).toBe(true);
  });

  it("uploads it at a later sync once there's space, and stops noting it", async () => {
    const { db, server, keep, sync, photosOf } = setup();
    const moment = keep("Walk", ["w1.jpg"]);
    server.failNext("createUpload", "overQuota", "storage");
    await sync();

    await sync();

    expect(photosOf(moment.id)[0].uploadState).toBe("uploaded");
    expect(getMeta(db, "photosWaitingForSpace")).toBe(false);
  });
});

describe("uploads per day", () => {
  it("waits, and the line says so", async () => {
    const { server, keep, sync, photosOf } = setup();
    const moment = keep("Walk", ["w1.jpg"]);
    server.failNext("createUpload", "overQuota", "uploadsPerDay");

    const status = await sync();

    expect(status).toMatchObject({ phase: "waiting", quota: "uploadsPerDay" });
    expect(syncLine(status, true, Date.now())).toBe(
      "Some changes will sync tomorrow",
    );
    expect(photosOf(moment.id)[0].uploadState).toBe("local");
  });
});
