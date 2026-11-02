import { getMeta } from "../db/app-meta";
import type { AppDb } from "../db/types";
import { SyncError, type SyncApi, type SyncErrorKind } from "./api";
import { pullChanges } from "./pull";
import { pushPending } from "./push";

// - idle: nothing to do, or the last sync worked
// - retrying: the last sync failed and another try is scheduled
// - stopped: the last sync failed in a way retrying won't fix; the next
//   trigger tries again
export type SyncStatus =
  | { phase: "idle" | "syncing"; lastSyncedAt: number | null }
  | {
      phase: "retrying";
      problem: "unavailable";
      lastSyncedAt: number | null;
    }
  | {
      phase: "stopped";
      problem: Exclude<SyncErrorKind, "unavailable">;
      lastSyncedAt: number | null;
    };

export type SyncEngineDeps = {
  db: AppDb;
  api: SyncApi;
  now: () => number;
  deleteFiles: (fileNames: string[]) => void;
  // Waits after the last local change before syncing
  debounceMs?: number;
  // Waits before each retry after failures in a row; the last one repeats
  retryDelaysMs?: number[];
};

type Timer = ReturnType<typeof setTimeout>;

// Runs syncs for one signed-in account (spec 005): push, then pull, one at a
// time, with retries. Triggers come from the app; the engine has no idea of
// React, the network or app state.
export class SyncEngine {
  status: SyncStatus;
  private running: Promise<void> | null = null;
  private queued = false;
  private stopped = false;
  private failures = 0;
  private retryTimer: Timer | null = null;
  private debounceTimer: Timer | null = null;
  private statusListeners = new Set<(status: SyncStatus) => void>();
  private changeListeners = new Set<() => void>();
  private readonly debounceMs: number;
  private readonly retryDelaysMs: number[];

  constructor(private readonly deps: SyncEngineDeps) {
    this.debounceMs = deps.debounceMs ?? 3_000;
    this.retryDelaysMs = deps.retryDelaysMs ?? [
      5_000, 30_000, 120_000, 600_000,
    ];
    this.status = {
      phase: "idle",
      lastSyncedAt: getMeta(deps.db, "lastSyncedAt"),
    };
  }

  // Syncs now, or once more after the sync that's running. Resolves when
  // done and never rejects: failures show in the status.
  sync(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.clearTimer("retryTimer");
    this.clearTimer("debounceTimer");
    if (this.running) {
      this.queued = true;
      return this.running;
    }
    this.running = this.runQueued().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  // Call after every local keep, edit or delete
  notifyLocalChange() {
    if (this.stopped) return;
    this.clearTimer("debounceTimer");
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.sync();
    }, this.debounceMs);
  }

  subscribe(listener: (status: SyncStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  // Called after a pull changed moments, so the screens can reload
  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  // For sign-out: no more syncs, retries or debounced syncs
  stop() {
    this.stopped = true;
    this.queued = false;
    this.clearTimer("retryTimer");
    this.clearTimer("debounceTimer");
  }

  private async runQueued() {
    do {
      this.queued = false;
      await this.runOnce();
    } while (this.queued && !this.stopped);
  }

  private async runOnce() {
    const { db, api, now, deleteFiles } = this.deps;
    this.setStatus({
      phase: "syncing",
      lastSyncedAt: this.status.lastSyncedAt,
    });
    try {
      await pushPending(db, api);
      const { changed } = await pullChanges(db, api, { now, deleteFiles });
      this.failures = 0;
      this.setStatus({
        phase: "idle",
        lastSyncedAt: getMeta(db, "lastSyncedAt"),
      });
      if (changed) this.changeListeners.forEach((listener) => listener());
    } catch (error) {
      this.fail(error);
    }
  }

  private fail(error: unknown) {
    const lastSyncedAt = this.status.lastSyncedAt;
    // Anything else, like a page that failed to apply, is worth another try
    const kind = error instanceof SyncError ? error.kind : "unavailable";
    if (kind !== "unavailable") {
      this.setStatus({ phase: "stopped", problem: kind, lastSyncedAt });
      return;
    }

    this.failures += 1;
    this.setStatus({ phase: "retrying", problem: kind, lastSyncedAt });
    if (this.stopped) return;
    const delays = this.retryDelaysMs;
    const delay = delays[Math.min(this.failures, delays.length) - 1];
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.sync();
    }, delay);
  }

  private setStatus(status: SyncStatus) {
    this.status = status;
    this.statusListeners.forEach((listener) => listener(status));
  }

  private clearTimer(name: "retryTimer" | "debounceTimer") {
    const timer = this[name];
    if (timer !== null) clearTimeout(timer);
    this[name] = null;
  }
}
