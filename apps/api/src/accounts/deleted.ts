import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { deletedAccounts } from "../db/schema";

// The cause of every refusal of a deleted account (spec 010). The error
// formatter turns it into data.reason, as the phone reads it.
export class AccountDeleted extends Error {
  readonly reason = "ACCOUNT_DELETED";
  constructor() {
    super("This account was deleted");
    this.name = "AccountDeleted";
  }
}

export const accountDeleted = () =>
  new TRPCError({
    code: "FORBIDDEN",
    message: "This account was deleted",
    cause: new AccountDeleted(),
  });

export async function isDeleted(db: Db, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: deletedAccounts.userId })
    .from(deletedAccounts)
    .where(eq(deletedAccounts.userId, userId));
  return row !== undefined;
}
