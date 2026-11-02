import type { PullOutput, PushInput, PushOutput } from "@savor/shared";

// What the sync engine needs from the server. The app implements it with
// tRPC; tests with a fake server.
export interface SyncApi {
  push(input: PushInput): Promise<PushOutput>;
  pull(input: { sinceVersion: number; limit: number }): Promise<PullOutput>;
}

// - conflict: the data belongs to another account (CONFLICT)
// - rejected: the server refused the input (BAD_REQUEST), a bug on our side
// - unauthorized: no valid token, so the session has ended
// - unavailable: no connection, a timeout or a server error; worth retrying
export type SyncErrorKind =
  "conflict" | "rejected" | "unauthorized" | "unavailable";

export class SyncError extends Error {
  constructor(
    readonly kind: SyncErrorKind,
    message: string = kind,
  ) {
    super(message);
    this.name = "SyncError";
  }
}
