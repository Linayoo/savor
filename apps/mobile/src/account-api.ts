// Account deletion on the server (spec 010). The app implements it with
// tRPC (sync/trpc-api.ts); tests with the fake server. Errors are
// SyncErrors.
export interface AccountApi {
  // Deletes the signed-in account and everything in it
  deleteAccount(): Promise<void>;
  // Whether this account was deleted in the last 90 days; needs no token
  wasDeleted(userId: string): Promise<boolean>;
}
