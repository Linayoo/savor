import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { describe, expect, it } from "vitest";
import { newUserId, testDb } from "../../test/db";
import { TEST_DATABASE_URL } from "../../test/env";
import { apiEvent, lambdaContext } from "../../test/events";
import { createDb } from "../db/client";
import { deletedAccounts } from "../db/schema";
import { createHandler } from "../handler";
import { unavailablePhotoStorage } from "../photos/storage";
import { appRouter } from "../router";
import { createCallerFactory } from "../trpc";
import { unavailableAccountDirectory } from "./directory";

// A phone whose tokens stopped working asks about its owner (spec 010)

const db = testDb();
const t = Date.UTC(2026, 10, 20, 9, 30);

const anyone = createCallerFactory(appRouter)({
  db,
  userId: null,
  photos: unavailablePhotoStorage,
  accounts: unavailableAccountDirectory,
});

describe("account.wasDeleted", () => {
  it("is true for an account being deleted or deleted", async () => {
    const deleting = newUserId();
    const deleted = newUserId();
    await db.insert(deletedAccounts).values([
      { userId: deleting, deletedAt: t },
      { userId: deleted, deletedAt: t, finishedAt: t },
    ]);

    expect(await anyone.account.wasDeleted({ userId: deleting })).toEqual({
      deleted: true,
    });
    expect(await anyone.account.wasDeleted({ userId: deleted })).toEqual({
      deleted: true,
    });
  });

  it("is false for any other id", async () => {
    expect(await anyone.account.wasDeleted({ userId: newUserId() })).toEqual({
      deleted: false,
    });
  });

  it("refuses an id that can't be a sub", async () => {
    await expect(
      anyone.account.wasDeleted({ userId: "x".repeat(129) }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("answers a request without a token, on its own route", async () => {
    const userId = newUserId();
    await db.insert(deletedAccounts).values({ userId, deletedAt: t });
    const handler = createHandler({
      getDatabaseUrl: async () => TEST_DATABASE_URL,
      createDb,
      photos: unavailablePhotoStorage,
      accounts: unavailableAccountDirectory,
    });

    const result = (await handler(
      apiEvent({ path: "account.wasDeleted", input: { userId } }),
      lambdaContext,
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body ?? "").result.data).toEqual({
      deleted: true,
    });
  });
});
