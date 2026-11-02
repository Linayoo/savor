import { getMeta, setMeta } from "../db/app-meta";
import type { AppDb } from "../db/types";

// The message for signing in with an account the phone doesn't belong to
// (spec 005)
export const OTHER_ACCOUNT_MESSAGE =
  "This phone holds moments from another account. Sign in with that account to keep syncing.";

// Called after Cognito accepted the sign-in, before any sync. A phone's
// moments belong to the first account that signs in on it; switching
// accounts is out of scope.
export function claimPhone(
  db: AppDb,
  userId: string,
): "claimed" | "owner" | "otherAccount" {
  return db.transaction((tx) => {
    const owner = getMeta(tx, "ownerUserId");
    if (owner === null) {
      setMeta(tx, "ownerUserId", userId);
      return "claimed";
    }
    return owner === userId ? "owner" : "otherAccount";
  });
}

export class OwnershipError extends Error {
  constructor() {
    super(OTHER_ACCOUNT_MESSAGE);
    this.name = "OwnershipError";
  }
}
