import { MAX_PHOTOS_PER_MOMENT, type Quota } from "@savor/shared";
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import type { Db } from "./db/client";
import { userQuotaUsage } from "./db/schema";

// The limits from spec 009, generous for a real person. Days are UTC days of
// arrival at the server.
export const LIMITS = {
  photosPerMoment: MAX_PHOTOS_PER_MOMENT,
  momentsPerDay: 500,
  uploadsPerDay: 300,
  storageBytes: 5 * 1024 ** 3,
};

// The cause of a quota refusal, which the error formatter (trpc.ts) turns
// into `data.quota`
export class QuotaExceeded extends Error {
  constructor(readonly quota: Quota) {
    super(`Over the ${quota} quota`);
    this.name = "QuotaExceeded";
  }
}

export const quotaExceeded = (quota: Quota) =>
  new TRPCError({
    code: "TOO_MANY_REQUESTS",
    message: `Over the ${quota} quota`,
    cause: new QuotaExceeded(quota),
  });

// The UTC day the daily quotas count by, as Postgres writes a date
export const utcDay = (time: number) =>
  new Date(time).toISOString().slice(0, 10);

// Adds to today's usage and returns the new total. Called inside the
// transaction that holds the user's sync lock (sync/push.ts), so calls for
// one user take turns; a refusal after it rolls the addition back too.
export async function addUsage(
  tx: Db,
  userId: string,
  time: number,
  column: "newMoments" | "uploads",
  amount: number,
): Promise<number> {
  const day = utcDay(time);
  const [row] = await tx
    .insert(userQuotaUsage)
    .values({ userId, day, [column]: amount })
    .onConflictDoUpdate({
      target: [userQuotaUsage.userId, userQuotaUsage.day],
      set: { [column]: sql`${userQuotaUsage[column]} + ${amount}` },
    })
    .returning();
  return row[column];
}
