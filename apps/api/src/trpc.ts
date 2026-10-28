import { initTRPC, TRPCError } from "@trpc/server";
import type { Db } from "./db/client";

export type Context = {
  db: Db;
  // The verified token's subject in AWS (handler.ts), the dev-only stand-in
  // locally (context.ts)
  userId: string | null;
};

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { ...ctx, userId: ctx.userId } });
});
