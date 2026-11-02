import { randomUUID } from "node:crypto";
import type { MomentChange } from "@savor/shared";
import { SyncError } from "@/sync/api";
import { FakeSyncServer } from "@/test-utils/fake-sync-server";

const t = Date.UTC(2026, 10, 1, 9, 30);

const moment = (change: Partial<MomentChange> = {}): MomentChange => ({
  id: randomUUID(),
  text: "Ramen with Ana",
  kind: "meal",
  createdAt: t,
  updatedAt: t,
  deletedAt: null,
  ...change,
});

// The fake stands in for the API in the sync engine tests, so it must keep
// the rules of apps/api/src/sync
describe("FakeSyncServer", () => {
  it("gives every change of a user a higher version", async () => {
    const server = new FakeSyncServer();
    const api = server.api("a");

    expect(
      await api.push({ moments: [moment(), moment()], photos: [] }),
    ).toEqual({ version: 2 });
    expect(await api.push({ moments: [moment()], photos: [] })).toEqual({
      version: 3,
    });
    expect(
      await server.api("b").push({ moments: [moment()], photos: [] }),
    ).toEqual({ version: 1 });
  });

  it("lets the last write win", async () => {
    const server = new FakeSyncServer();
    const api = server.api("a");
    const m = moment();

    await api.push({ moments: [m], photos: [] });
    await api.push({
      moments: [{ ...m, text: "Ramen", updatedAt: t + 1 }],
      photos: [],
    });

    expect(server.momentsOf("a")).toEqual([
      { ...m, text: "Ramen", updatedAt: t + 1 },
    ]);
  });

  it("keeps deletes final", async () => {
    const server = new FakeSyncServer();
    const api = server.api("a");
    const m = moment();

    await api.push({
      moments: [{ ...m, deletedAt: t + 1, updatedAt: t + 1 }],
      photos: [],
    });
    await api.push({
      moments: [{ ...m, text: "back?", updatedAt: t + 2 }],
      photos: [],
    });

    expect(server.momentsOf("a")).toEqual([
      { ...m, deletedAt: t + 1, updatedAt: t + 1 },
    ]);
  });

  it("refuses another user's moment with a conflict and stores nothing", async () => {
    const server = new FakeSyncServer();
    const m = moment();
    await server.api("a").push({ moments: [m], photos: [] });

    await expect(
      server
        .api("b")
        .push({ moments: [moment(), { ...m, text: "mine" }], photos: [] }),
    ).rejects.toEqual(new SyncError("conflict"));
    expect(server.momentsOf("b")).toEqual([]);
    expect(server.momentsOf("a")).toEqual([m]);
  });

  it("rejects a push of more than 100 items", async () => {
    const server = new FakeSyncServer();

    await expect(
      server.api("a").push({
        moments: Array.from({ length: 101 }, () => moment()),
        photos: [],
      }),
    ).rejects.toMatchObject({ kind: "rejected" });
  });

  it("pulls a user's changes page by page in version order", async () => {
    const server = new FakeSyncServer();
    const api = server.api("a");
    const [m1, m2, m3] = [moment(), moment(), moment()];
    await api.push({ moments: [m1, m2, m3], photos: [] });
    await server.api("b").push({ moments: [moment()], photos: [] });

    const first = await api.pull({ sinceVersion: 0, limit: 2 });
    const second = await api.pull({ sinceVersion: first.version, limit: 2 });

    expect(first).toMatchObject({ version: 2, hasMore: true });
    expect(first.moments.map((m) => m.id)).toEqual([m1.id, m2.id]);
    expect(second).toMatchObject({ version: 3, hasMore: false });
    expect(second.moments).toEqual([{ ...m3, version: 3 }]);
  });

  it("fails the next call when told to, then works again", async () => {
    const server = new FakeSyncServer();
    const api = server.api("a");
    server.failNext("pull");

    await expect(
      api.pull({ sinceVersion: 0, limit: 10 }),
    ).rejects.toMatchObject({ kind: "unavailable" });
    await expect(
      api.pull({ sinceVersion: 0, limit: 10 }),
    ).resolves.toMatchObject({ version: 0 });
  });

  it("can hold a push in flight until released", async () => {
    const server = new FakeSyncServer();
    const api = server.api("a");
    const held = server.holdNextPush();
    const m = moment();

    const push = api.push({ moments: [m], photos: [] });
    await held.started;
    expect(server.momentsOf("a")).toEqual([]);
    held.release();

    await expect(push).resolves.toEqual({ version: 1 });
    expect(server.momentsOf("a")).toEqual([m]);
  });
});
