import type { AccountDirectory } from "../src/accounts/directory";

type Call = keyof AccountDirectory;

// Cognito's admin calls in memory, for API tests. Like the real one
// (cognito-directory.ts), a user that's already gone counts as done.
export class FakeAccountDirectory implements AccountDirectory {
  readonly users = new Set<string>();
  // Users whose sessions were revoked, in order
  readonly signedOut: string[] = [];
  private failing = new Set<Call>();

  // The next call of this kind fails, as an unreachable Cognito would
  failNext(call: Call) {
    this.failing.add(call);
  }

  async signOutEverywhere(userId: string) {
    this.fail("signOutEverywhere");
    if (this.users.has(userId)) this.signedOut.push(userId);
  }

  async deleteUser(userId: string) {
    this.fail("deleteUser");
    this.users.delete(userId);
  }

  private fail(call: Call) {
    if (this.failing.delete(call)) throw new Error("Cognito is unavailable");
  }
}
