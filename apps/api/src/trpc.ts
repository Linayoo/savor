import { initTRPC, TRPCError } from "@trpc/server";
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

// A quota refusal names its quota, so the app can say what happens next
const t = initTRPC.context<Context>().create({
  errorFormatter: ({ shape, error }) =>
    error.cause instanceof QuotaExceeded
      ? { ...shape, data: { ...shape.data, quota: error.cause.quota } }
      : shape,
});

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { ...ctx, userId: ctx.userId } });
});
