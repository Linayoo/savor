import {
  pullInputSchema,
  pushInputSchema,
  type MomentChange,
  type PhotoChange,
  type PullOutput,
  type PushInput,
} from "@savor/shared";
import { SyncError, type SyncApi, type SyncErrorKind } from "@/sync/api";

type Stored<T> = T & { userId: string; version: number };

// An in-memory stand-in for the deployed API, with the server rules from
// spec 003 (apps/api/src/sync): per-user increasing versions, last write wins,
// deletes are final, another user's ids are a CONFLICT, and a push is all or
// nothing.
export class FakeSyncServer {
  private moments = new Map<string, Stored<MomentChange>>();
  private photos = new Map<string, Stored<PhotoChange>>();
  private versions = new Map<string, number>();
  private faults: { method: "push" | "pull"; kind: SyncErrorKind }[] = [];
  private hold: { started: () => void; released: Promise<void> } | null = null;

  // Every push the server received, accepted or not
  readonly pushes: { userId: string; input: PushInput }[] = [];
  readonly pulls: { userId: string; sinceVersion: number }[] = [];

  // A client signed in as userId
  api(userId: string): SyncApi {
    return {
      push: (input) => this.push(userId, input),
      pull: (input) => this.pull(userId, input),
    };
  }

  // The next call to method fails with kind, as a network error or the
  // server would
  failNext(method: "push" | "pull", kind: SyncErrorKind = "unavailable") {
    this.faults.push({ method, kind });
  }

  // Keeps the next push in flight: the server has the request but answers
  // only after release()
  holdNextPush() {
    let started!: () => void;
    let release!: () => void;
    const startedPromise = new Promise<void>((r) => (started = r));
    this.hold = { started, released: new Promise<void>((r) => (release = r)) };
    return { started: startedPromise, release };
  }

  // What the server holds for a user, without versions, for assertions
  momentsOf(userId: string): MomentChange[] {
    return [...this.moments.values()]
      .filter((m) => m.userId === userId)
      .map(({ userId: _, version: __, ...m }) => m);
  }

  // Adds a server-side change directly, as another device would
  seed(userId: string, input: PushInput) {
    this.apply(userId, pushInputSchema.parse(input));
  }

  private takeFault(method: "push" | "pull") {
    const i = this.faults.findIndex((f) => f.method === method);
    if (i === -1) return;
    const [fault] = this.faults.splice(i, 1);
    throw new SyncError(fault.kind);
  }

  private async push(userId: string, raw: PushInput) {
    // Like a real request, the server sees a copy of what was sent
    const sent = structuredClone(raw);
    this.pushes.push({ userId, input: sent });
    await Promise.resolve();
    this.takeFault("push");

    const hold = this.hold;
    if (hold) {
      this.hold = null;
      hold.started();
      await hold.released;
    }

    const parsed = pushInputSchema.safeParse(sent);
    if (!parsed.success) throw new SyncError("rejected", parsed.error.message);
    return { version: this.apply(userId, parsed.data) };
  }

  private apply(userId: string, input: PushInput): number {
    const momentIds = [
      ...input.moments.map((m) => m.id),
      ...input.photos.map((p) => p.momentId),
    ];
    const otherUsers =
      momentIds.some((id) => {
        const row = this.moments.get(id);
        return row && row.userId !== userId;
      }) ||
      input.photos.some((p) => {
        const row = this.photos.get(p.id);
        return row && row.userId !== userId;
      });
    if (otherUsers) throw new SyncError("conflict");

    let version = this.versions.get(userId) ?? 0;
    for (const change of input.moments) {
      version += 1;
      upsert(this.moments, change, userId, version);
    }
    for (const change of input.photos) {
      version += 1;
      upsert(this.photos, change, userId, version);
    }
    this.versions.set(userId, version);
    return version;
  }

  private async pull(
    userId: string,
    raw: { sinceVersion: number; limit: number },
  ): Promise<PullOutput> {
    const { sinceVersion, limit } = pullInputSchema.parse(raw);
    this.pulls.push({ userId, sinceVersion });
    await Promise.resolve();
    this.takeFault("pull");

    const newer = <T>(rows: Map<string, Stored<T>>) =>
      [...rows.values()].filter(
        (r) => r.userId === userId && r.version > sinceVersion,
      );
    const merged = [
      ...newer(this.moments).map((row) => ({ type: "moment" as const, row })),
      ...newer(this.photos).map((row) => ({ type: "photo" as const, row })),
    ].sort((a, b) => a.row.version - b.row.version);
    const page = merged.slice(0, limit);

    const output: PullOutput = {
      moments: [],
      photos: [],
      version: page.at(-1)?.row.version ?? sinceVersion,
      hasMore: merged.length > limit,
    };
    for (const item of page) {
      if (item.type === "moment") {
        const { userId: _, ...change } = item.row;
        output.moments.push(structuredClone(change));
      } else {
        const { userId: _, ...change } = item.row;
        output.photos.push(structuredClone(change));
      }
    }
    return output;
  }
}

// Last write wins, but a deleted row only takes another delete. The version
// moves on either way, as on the server.
function upsert<T extends { id: string; deletedAt: number | null }>(
  rows: Map<string, Stored<T>>,
  change: T,
  userId: string,
  version: number,
) {
  const existing = rows.get(change.id);
  if (existing && existing.deletedAt !== null && change.deletedAt === null) {
    return;
  }
  rows.set(change.id, { ...structuredClone(change), userId, version });
}
