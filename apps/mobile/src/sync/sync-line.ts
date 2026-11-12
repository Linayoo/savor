import type { SyncStatus } from "./engine";

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

const ago = (n: number, unit: string) =>
  `${n} ${unit}${n === 1 ? "" : "s"} ago`;

// The one quiet line about sync on the Account screen (specs 005 and 006).
// No counts of moments or photos, no warnings in the timeline.
export function syncLine(
  status: SyncStatus,
  online: boolean,
  now: number,
): string {
  if (!online) return "Waiting for a connection";
  if (status.phase === "waiting") return "Some changes will sync tomorrow";
  if (status.phase === "retrying" || status.phase === "stopped") {
    return "Couldn't sync, will try again";
  }
  if (status.phase === "syncing" && status.activity === "uploading") {
    return "Uploading photos";
  }
  if (status.phase === "syncing" && status.activity === "downloading") {
    return "Downloading photos";
  }
  const { lastSyncedAt } = status;
  if (lastSyncedAt === null) return "Syncing for the first time";

  const elapsed = Math.max(0, now - lastSyncedAt);
  if (elapsed < minute) return "Synced just now";
  if (elapsed < hour)
    return `Synced ${ago(Math.floor(elapsed / minute), "minute")}`;
  if (elapsed < day) return `Synced ${ago(Math.floor(elapsed / hour), "hour")}`;
  return `Synced ${ago(Math.floor(elapsed / day), "day")}`;
}
