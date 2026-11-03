import { syncLine } from "@/sync/sync-line";

const now = Date.UTC(2026, 10, 2, 12, 0);
const idle = (lastSyncedAt: number | null) =>
  ({ phase: "idle", lastSyncedAt }) as const;

describe("syncLine", () => {
  it.each([
    [now - 20_000, "Synced just now"],
    [now - 60_000, "Synced 1 minute ago"],
    [now - 25 * 60_000, "Synced 25 minutes ago"],
    [now - 3 * 3_600_000, "Synced 3 hours ago"],
    [now - 2 * 86_400_000, "Synced 2 days ago"],
  ])("says when the last sync was (%p)", (lastSyncedAt, line) => {
    expect(syncLine(idle(lastSyncedAt), true, now)).toBe(line);
  });

  it.each([
    ["uploading", "Uploading photos"],
    ["downloading", "Downloading photos"],
  ] as const)("says when it's %s photos", (activity, line) => {
    expect(
      syncLine(
        { phase: "syncing", activity, lastSyncedAt: now - 60_000 },
        true,
        now,
      ),
    ).toBe(line);
  });

  it("waits for a connection while offline", () => {
    expect(syncLine(idle(now - 60_000), false, now)).toBe(
      "Waiting for a connection",
    );
  });

  it("says it will try again after a failure", () => {
    expect(
      syncLine(
        { phase: "retrying", problem: "unavailable", lastSyncedAt: null },
        true,
        now,
      ),
    ).toBe("Couldn't sync, will try again");
    expect(
      syncLine(
        { phase: "stopped", problem: "conflict", lastSyncedAt: now },
        true,
        now,
      ),
    ).toBe("Couldn't sync, will try again");
  });

  it("keeps the last line while a sync runs", () => {
    expect(
      syncLine({ phase: "syncing", lastSyncedAt: now - 60_000 }, true, now),
    ).toBe("Synced 1 minute ago");
    expect(syncLine({ phase: "syncing", lastSyncedAt: null }, true, now)).toBe(
      "Syncing for the first time",
    );
  });
});
