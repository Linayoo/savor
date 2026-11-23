import { initTRPC, TRPCError } from "@trpc/server";
import { AccountDeleted, accountDeleted, isDeleted } from "./accounts/deleted";
import type { Db } from "./db/client";
import type { PhotoStorage } from "./photos/storage";
import { QuotaExceeded } from "./quotas";

export type Context = {
  db: Db;
  // The verified token's subject in AWS (handler.ts), the dev-only stand-in
  // locally (context.ts)
  userId: string | null;
  photos: PhotoStorage;
};

// A quota refusal names its quota, so the app can say what happens next; a
// deleted account's refusal says so (spec 010)
const t = initTRPC.context<Context>().create({
  errorFormatter: ({ shape, error }) => {
    if (error.cause instanceof QuotaExceeded) {
      return { ...shape, data: { ...shape.data, quota: error.cause.quota } };
    }
    if (error.cause instanceof AccountDeleted) {
      return { ...shape, data: { ...shape.data, reason: error.cause.reason } };
    }
    return shape;
  },
});

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;
export const publicProcedure = t.procedure;

// A verified token, nothing more. Only account.delete uses it directly: it
// runs again for an account that's already marked, to finish its deletion.
export const authedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { ...ctx, userId: ctx.userId } });
});

// Every other procedure with a user: refused once the account is marked
// deleted (spec 010). Writers check again under the user's sync lock
// (sync/push.ts).
export const protectedProcedure = authedProcedure.use(async ({ ctx, next }) => {
  if (await isDeleted(ctx.db, ctx.userId)) throw accountDeleted();
  return next();
});
