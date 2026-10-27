import {
  pullInputSchema,
  pullOutputSchema,
  pushInputSchema,
  pushOutputSchema,
} from "@savor/shared";
import { pull } from "./sync/pull";
import { push } from "./sync/push";
import { protectedProcedure, publicProcedure, router } from "./trpc";

export const appRouter = router({
  health: router({
    check: publicProcedure.query(() => ({ ok: true as const })),
  }),
  sync: router({
    push: protectedProcedure
      .input(pushInputSchema)
      .output(pushOutputSchema)
      .mutation(({ ctx, input }) => push(ctx.db, ctx.userId, input)),
    pull: protectedProcedure
      .input(pullInputSchema)
      .output(pullOutputSchema)
      .query(({ ctx, input }) => pull(ctx.db, ctx.userId, input)),
  }),
});

export type AppRouter = typeof appRouter;
