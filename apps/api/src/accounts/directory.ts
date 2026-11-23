// Cognito's admin calls for account deletion (spec 010): the user pool in
// AWS (cognito-directory.ts), a fake in tests. A user that's already gone
// counts as done, so a deletion can always be tried again.
export interface AccountDirectory {
  // Refresh tokens stop working; access tokens last until they expire
  signOutEverywhere(userId: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;
}

// For the local dev server, which has no user pool
export const unavailableAccountDirectory: AccountDirectory = {
  signOutEverywhere: unavailable,
  deleteUser: unavailable,
};

async function unavailable(): Promise<never> {
  throw new Error("Account deletion is only available in AWS");
}
