import { TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { describe, expect, it } from "vitest";
import { testDb } from "../test/db";
import { appRouter } from "./router";
import {
  createCallerFactory,
  protectedProcedure,
  publicProcedure,
  router,
} from "./trpc";
import { unavailablePhotoStorage } from "./photos/storage";
import { quotaExceeded } from "./quotas";

const db = testDb();

describe("health.check", () => {
  it("works without a user", async () => {
    const caller = createCallerFactory(appRouter)({
      db,
      userId: null,
      photos: unavailablePhotoStorage,
    });

    expect(await caller.health.check()).toEqual({ ok: true });
  });
});

describe("protectedProcedure", () => {
  const testRouter = router({
    whoAmI: protectedProcedure.query(({ ctx }) => ctx.userId),
    open: publicProcedure.query(() => "open"),
  });
  const callerFor = (userId: string | null) =>
    createCallerFactory(testRouter)({
      db,
      userId,
      photos: unavailablePhotoStorage,
    });

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

describe("quota refusals", () => {
  const testRouter = router({
    full: publicProcedure.mutation(() => {
      throw quotaExceeded("storage");
    }),
    broken: publicProcedure.mutation(() => {
      throw new TRPCError({ code: "BAD_REQUEST" });
    }),
  });
  // Over HTTP, as the phone sees them
  const call = async (path: string) => {
    const response = await fetchRequestHandler({
      endpoint: "/",
      req: new Request(`http://localhost/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      }),
      router: testRouter,
      createContext: () => ({
        db,
        userId: null,
        photos: unavailablePhotoStorage,
      }),
    });
    return { status: response.status, body: await response.json() };
  };

  it("answer 429 and name the quota", async () => {
    const { status, body } = await call("full");

    expect(status).toBe(429);
    expect(body.error.data).toMatchObject({
      code: "TOO_MANY_REQUESTS",
      quota: "storage",
    });
  });

  it("leave other errors without a quota", async () => {
    const { body } = await call("broken");

    expect(body.error.data.code).toBe("BAD_REQUEST");
    expect(body.error.data).not.toHaveProperty("quota");
  });
});
