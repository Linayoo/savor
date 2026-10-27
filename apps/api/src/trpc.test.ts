import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import { testDb } from "../test/db";
import { appRouter } from "./router";
import {
  createCallerFactory,
  protectedProcedure,
  publicProcedure,
  router,
} from "./trpc";

const db = testDb();

describe("health.check", () => {
  it("works without a user", async () => {
    const caller = createCallerFactory(appRouter)({ db, userId: null });

    expect(await caller.health.check()).toEqual({ ok: true });
  });
});

describe("protectedProcedure", () => {
  const testRouter = router({
    whoAmI: protectedProcedure.query(({ ctx }) => ctx.userId),
    open: publicProcedure.query(() => "open"),
  });
  const callerFor = (userId: string | null) =>
    createCallerFactory(testRouter)({ db, userId });

  it("rejects a call without a user with UNAUTHORIZED", async () => {
    const call = callerFor(null).whoAmI();

    await expect(call).rejects.toBeInstanceOf(TRPCError);
    await expect(call).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("passes the user id on to the procedure", async () => {
    expect(await callerFor("user-1").whoAmI()).toBe("user-1");
  });

  it("leaves public procedures open", async () => {
    expect(await callerFor(null).open()).toBe("open");
  });
});
