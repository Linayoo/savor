import type {
  ConfirmUploadOutput,
  CreateUploadOutput,
  DownloadUrlsOutput,
  PullOutput,
  PushInput,
  PushOutput,
} from "@savor/shared";

// What the sync engine needs from the server. The app implements it with
// tRPC; tests with a fake server.
export interface SyncApi {
  push(input: PushInput): Promise<PushOutput>;
  pull(input: { sinceVersion: number; limit: number }): Promise<PullOutput>;
  // Photo files (spec 006)
  createUpload(input: { photoId: string }): Promise<CreateUploadOutput>;
  confirmUpload(input: { photoId: string }): Promise<ConfirmUploadOutput>;
  downloadUrls(input: { photoIds: string[] }): Promise<DownloadUrlsOutput>;
}

// - conflict: the data belongs to another account (CONFLICT)
// - rejected: the server refused the input (BAD_REQUEST), a bug on our side
// - unauthorized: no valid token, so the session has ended
// - unavailable: no connection, a timeout or a server error; worth retrying
// - notFound: a photo the server doesn't have, or no longer has (NOT_FOUND);
//   the photo queues handle it, it never fails a sync
export type SyncErrorKind =
  "conflict" | "rejected" | "unauthorized" | "unavailable" | "notFound";

export class SyncError extends Error {
  constructor(
    readonly kind: SyncErrorKind,
    message: string = kind,
  ) {
    super(message);
    this.name = "SyncError";
  }
}
