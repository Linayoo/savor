import { getMeta } from "../db/app-meta";
import type { AppDb } from "../db/types";
import { SyncError, type SyncApi, type SyncErrorKind } from "./api";
import type { PhotoTransfer } from "./photo-transfer";
import { pullChanges } from "./pull";
import { pushPending } from "./push";
import { uploadPhotos } from "./upload";

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
      problem: Exclude<SyncErrorKind, "unavailable" | "notFound">;
      lastSyncedAt: number | null;
    };

export type SyncEngineDeps = {
  db: AppDb;
  api: SyncApi;
  now: () => number;
  deleteFiles: (fileNames: string[]) => void;
  transfer: PhotoTransfer;
  // Waits after the last local change before syncing
  debounceMs?: number;
  // Waits before each retry after failures in a row; the last one repeats
  retryDelaysMs?: number[];
};

type Timer = ReturnType<typeof setTimeout>;

// Runs syncs for one signed-in account (specs 005 and 006): push, pull, then
// the photo files, one sync at a time, with retries. Triggers come from the app; the engine has no idea of
// React, the network or app state.
export class SyncEngine {
  status: SyncStatus;
  private running: Promise<void> | null = null;
  private queued = false;
  private stopped = false;
  // Bumped by stop(), so a sync that was running reports nothing afterwards
  private generation = 0;
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

  // Called after a sync changed moments or photos here, so the screens can
  // reload
  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  // For sign-out: no more syncs, retries or debounced syncs. A sync that's
  // running finishes, but its result is ignored: a failure caused by the
  // sign-out clearing the tokens isn't an ended session.
  stop() {
    this.stopped = true;
    this.generation += 1;
    this.queued = false;
    this.clearTimer("retryTimer");
    this.clearTimer("debounceTimer");
  }

  // After a sign-out that failed
  resume() {
    this.stopped = false;
  }

  private async runQueued() {
    do {
      this.queued = false;
      await this.runOnce();
    } while (this.queued && !this.stopped);
  }

  private async runOnce() {
    const { db, api, now, deleteFiles, transfer } = this.deps;
    const generation = this.generation;
    const cancelled = () => generation !== this.generation;
    this.setStatus({
      phase: "syncing",
      lastSyncedAt: this.status.lastSyncedAt,
    });
    try {
      await pushPending(db, api);
      const { changed } = await pullChanges(db, api, { now, deleteFiles });
      if (cancelled()) return;
      if (changed) this.notifyChange();

      const uploads = await uploadPhotos(db, api, transfer, now);
      if (uploads.missingFiles) {
        this.notifyChange();
        await pushPending(db, api);
      }
      if (uploads.failure) throw uploads.failure;
      if (cancelled()) return;
      this.failures = 0;
      this.setStatus({
        phase: "idle",
        lastSyncedAt: getMeta(db, "lastSyncedAt"),
      });
    } catch (error) {
      if (!cancelled()) this.fail(error);
    }
  }

  private notifyChange() {
    this.changeListeners.forEach((listener) => listener());
  }

  private fail(error: unknown) {
    const lastSyncedAt = this.status.lastSyncedAt;
    // Anything else, like a page that failed to apply, is worth another try
    const kind = error instanceof SyncError ? error.kind : "unavailable";
    if (kind !== "unavailable" && kind !== "notFound") {
      this.setStatus({ phase: "stopped", problem: kind, lastSyncedAt });
      return;
    }

    this.failures += 1;
    this.setStatus({ phase: "retrying", problem: "unavailable", lastSyncedAt });
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
