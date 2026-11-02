import { randomUUID } from "node:crypto";
import { getMeta, setMeta } from "@/db/app-meta";
import { insertMoment } from "@/db/moments-store";
import { SyncError, type SyncApi } from "@/sync/api";
import { SyncEngine, type SyncStatus } from "@/sync/engine";
import { createTestDb } from "@/test-utils/db";
import { FakeSyncServer } from "@/test-utils/fake-sync-server";

const t = Date.UTC(2026, 10, 1, 9, 30);

function setup(wrap: (api: SyncApi) => SyncApi = (api) => api) {
  const db = createTestDb();
  const server = new FakeSyncServer();
  const calls: string[] = [];
  const inner = server.api("user-a");
  const api = wrap({
    push: (input) => {
      calls.push("push");
      return inner.push(input);
    },
    pull: (input) => {
      calls.push("pull");
      return inner.pull(input);
    },
  });
  const engine = new SyncEngine({
    db,
    api,
    now: () => Date.now(),
    deleteFiles: jest.fn(),
  });
  const statuses: SyncStatus[] = [];
  engine.subscribe((s) => statuses.push(s));
  const keep = (text: string) =>
    insertMoment(db, { text, photos: [] }, { newId: randomUUID, now: () => t });
  return { db, server, calls, engine, statuses, keep };
}

// An api whose calls fail until told otherwise
function failing(kind: SyncError["kind"] = "unavailable") {
  const state = { failing: true, attempts: 0 };
  const wrap = (api: SyncApi): SyncApi => ({
    push: (input) => {
      state.attempts += 1;
      return state.failing
        ? Promise.reject(new SyncError(kind))
        : api.push(input);
    },
    pull: (input) => {
      state.attempts += 1;
      return state.failing
        ? Promise.reject(new SyncError(kind))
        : api.pull(input);
    },
  });
  return { state, wrap };
}

beforeEach(() => {
  jest.useFakeTimers({ now: t });
});
afterEach(() => {
  jest.useRealTimers();
});

describe("SyncEngine", () => {
  it("pushes first, then pulls, and records the sync", async () => {
    const { db, server, calls, engine, keep } = setup();
    keep("Ramen");

    await engine.sync();

    expect(calls).toEqual(["push", "pull"]);
    expect(server.momentsOf("user-a")).toHaveLength(1);
    expect(engine.status).toEqual({ phase: "idle", lastSyncedAt: t });
    expect(getMeta(db, "lastSyncedAt")).toBe(t);
  });

  it("runs one sync at a time, and queues one more for triggers during it", async () => {
    const { server, calls, engine, keep } = setup();
    keep("Ramen");
    const held = server.holdNextPush();

    const first = engine.sync();
    await held.started;
    const second = engine.sync();
    const third = engine.sync();
    held.release();
    await Promise.all([first, second, third]);

    expect(calls).toEqual(["push", "pull", "pull"]);
  });

  it("tells listeners when a pull changed moments", async () => {
    const { server, engine } = setup();
    const changed = jest.fn();
    engine.onChange(changed);

    await engine.sync();
    expect(changed).not.toHaveBeenCalled();

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
    await engine.sync();
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("syncs a few seconds after the last local change", async () => {
    const { calls, engine, keep } = setup();

    keep("a");
    engine.notifyLocalChange();
    await jest.advanceTimersByTimeAsync(2000);
    keep("b");
    engine.notifyLocalChange();
    await jest.advanceTimersByTimeAsync(2999);
    expect(calls).toEqual([]);

    await jest.advanceTimersByTimeAsync(1);
    expect(calls).toEqual(["push", "pull"]);
  });

  it("retries a failed sync after 5 s, 30 s, 2 min, then every 10 min", async () => {
    const { state, wrap } = failing();
    const { engine } = setup(wrap);

    await engine.sync();
    expect(state.attempts).toBe(1);

    for (const [wait, attempts] of [
      [5_000, 2],
      [30_000, 3],
      [120_000, 4],
      [600_000, 5],
      [600_000, 6],
    ] as const) {
      await jest.advanceTimersByTimeAsync(wait - 1);
      expect(state.attempts).toBe(attempts - 1);
      await jest.advanceTimersByTimeAsync(1);
      expect(state.attempts).toBe(attempts);
    }
  });

  it("reports a failure it will retry, and recovers", async () => {
    const { state, wrap } = failing();
    const { engine, statuses } = setup(wrap);

    await engine.sync();
    expect(engine.status).toEqual({
      phase: "retrying",
      problem: "unavailable",
      lastSyncedAt: null,
    });

    state.failing = false;
    await jest.advanceTimersByTimeAsync(5_000);
    expect(engine.status).toEqual({ phase: "idle", lastSyncedAt: t + 5_000 });
    expect(statuses.map((s) => s.phase)).toEqual([
      "syncing",
      "retrying",
      "syncing",
      "idle",
    ]);
  });

  it("syncs right away on a trigger during the backoff, and keeps backing off if that fails too", async () => {
    const { state, wrap } = failing();
    const { engine } = setup(wrap);
    await engine.sync();
    await jest.advanceTimersByTimeAsync(5_000);
    expect(state.attempts).toBe(2);

    await engine.sync();
    expect(state.attempts).toBe(3);

    // The waiting 30 s retry was replaced; this was the third failure in a row
    await jest.advanceTimersByTimeAsync(119_999);
    expect(state.attempts).toBe(3);
    await jest.advanceTimersByTimeAsync(1);
    expect(state.attempts).toBe(4);
  });

  it("starts the backoff over after a successful sync", async () => {
    const { state, wrap } = failing();
    const { engine } = setup(wrap);
    await engine.sync();
    await jest.advanceTimersByTimeAsync(5_000);
    state.failing = false;
    await jest.advanceTimersByTimeAsync(30_000);
    state.failing = true;

    await engine.sync();
    const before = state.attempts;
    await jest.advanceTimersByTimeAsync(5_000);
    expect(state.attempts).toBe(before + 1);
  });

  it.each(["conflict", "rejected", "unauthorized"] as const)(
    "stops at %s without retrying, until the next trigger",
    async (kind) => {
      const { state, wrap } = failing(kind);
      const { engine } = setup(wrap);

      await engine.sync();
      await jest.advanceTimersByTimeAsync(60 * 60_000);

      expect(state.attempts).toBe(1);
      expect(engine.status).toEqual({
        phase: "stopped",
        problem: kind,
        lastSyncedAt: null,
      });

      await engine.sync();
      expect(state.attempts).toBe(2);
    },
  );

  it("treats an unexpected error, like a page that fails to apply, as worth retrying", async () => {
    let fail = true;
    const { engine } = setup((api) => ({
      ...api,
      pull: (input) =>
        fail ? Promise.reject(new Error("bad row")) : api.pull(input),
    }));

    await engine.sync();
    expect(engine.status).toMatchObject({
      phase: "retrying",
      problem: "unavailable",
    });

    fail = false;
    await jest.advanceTimersByTimeAsync(5_000);
    expect(engine.status.phase).toBe("idle");
  });

  it("never rejects, so callers like pull-to-refresh can just await it", async () => {
    const { wrap } = failing();
    const { engine } = setup(wrap);

    await expect(engine.sync()).resolves.toBeUndefined();
  });

  it("does nothing once stopped, and cancels waiting retries and debounces", async () => {
    const { state, wrap } = failing();
    const { engine } = setup(wrap);
    await engine.sync();
    engine.notifyLocalChange();

    engine.stop();
    await jest.advanceTimersByTimeAsync(60 * 60_000);
    await engine.sync();

    expect(state.attempts).toBe(1);
  });

  it("starts from the last sync time stored on the phone", async () => {
    const { db } = setup();
    setMeta(db, "lastSyncedAt", t - 3_600_000);

    const engine = new SyncEngine({
      db,
      api: new FakeSyncServer().api("user-a"),
      now: () => Date.now(),
      deleteFiles: jest.fn(),
    });

    expect(engine.status).toEqual({
      phase: "idle",
      lastSyncedAt: t - 3_600_000,
    });
  });
});
