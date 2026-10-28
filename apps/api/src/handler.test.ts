import type { PushInput } from "@savor/shared";
import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newUserId } from "../test/db";
import { FAILING_TEXT, TEST_DATABASE_URL } from "../test/env";
import { apiEvent, lambdaContext } from "../test/events";
import { createDb } from "./db/client";
import { createHandler, type HandlerEvent } from "./handler";

// The handler on the test database, counting secret reads and closed pools
function setup() {
  const getDatabaseUrl = vi.fn(async () => TEST_DATABASE_URL);
  const closed = vi.fn();
  const openDb = vi.fn((url: string) => {
    const { db, close } = createDb(url);
    return {
      db,
      close: async () => {
        await close();
        closed();
      },
    };
  });
  const handler = createHandler({ getDatabaseUrl, createDb: openDb });
  const call = async (event: HandlerEvent) => {
    const result = (await handler(
      event,
      lambdaContext,
    )) as APIGatewayProxyStructuredResultV2;
    return { status: result.statusCode, body: JSON.parse(result.body ?? "") };
  };
  return { handler, call, getDatabaseUrl, openDb, closed };
}

const moment = (text = "Ramen") => ({
  id: randomUUID(),
  text,
  kind: "meal" as const,
  createdAt: 1790847000000,
  updatedAt: 1790847000000,
  deletedAt: null,
});

type More = Omit<Parameters<typeof apiEvent>[0], "path" | "input">;

const pushEvent = (input: PushInput, more: More) =>
  apiEvent({ ...more, method: "POST", path: "sync.push", input });

const pullEvent = (more: More) =>
  apiEvent({ ...more, path: "sync.pull", input: { sinceVersion: 0 } });

const pulledIds = (body: { result: { data: { moments: { id: string }[] } } }) =>
  body.result.data.moments.map((m) => m.id);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("handler", () => {
  it("takes the user from the token's sub claim", async () => {
    const { call } = setup();
    const user = newUserId();
    const kept = moment();

    const pushed = await call(
      pushEvent({ moments: [kept], photos: [] }, { claims: { sub: user } }),
    );
    const pulled = await call(pullEvent({ claims: { sub: user } }));

    expect(pushed.status).toBe(200);
    expect(pulled.status).toBe(200);
    expect(pulledIds(pulled.body)).toEqual([kept.id]);
  });

  it("answers 401 to sync calls without claims", async () => {
    const { call } = setup();

    const pushed = await call(
      pushEvent({ moments: [moment()], photos: [] }, {}),
    );
    const pulled = await call(pullEvent({}));

    expect(pushed.status).toBe(401);
    expect(pulled.status).toBe(401);
  });

  it.each([[""], [42]])("treats a sub of %j as no user", async (sub) => {
    const { call } = setup();

    const pulled = await call(pullEvent({ claims: { sub } }));

    expect(pulled.status).toBe(401);
  });

  it("ignores x-dev-user-id without a token, even in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { call } = setup();

    const pulled = await call(
      pullEvent({ headers: { "x-dev-user-id": newUserId() } }),
    );

    expect(pulled.status).toBe(401);
  });

  it("acts as the token's user when x-dev-user-id names another", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { call } = setup();
    const ana = newUserId();
    const ben = newUserId();
    const kept = moment();

    await call(
      pushEvent(
        { moments: [kept], photos: [] },
        { claims: { sub: ana }, headers: { "x-dev-user-id": ben } },
      ),
    );

    const anaPull = await call(pullEvent({ claims: { sub: ana } }));
    const benPull = await call(pullEvent({ claims: { sub: ben } }));
    expect(pulledIds(anaPull.body)).toEqual([kept.id]);
    expect(pulledIds(benPull.body)).toEqual([]);
  });

  it("answers health.check without a token", async () => {
    const { call } = setup();

    const health = await call(apiEvent({ path: "health.check" }));

    expect(health).toEqual({
      status: 200,
      body: { result: { data: { ok: true } } },
    });
  });

  it("returns on a keepwarm event without touching the database", async () => {
    const { handler, getDatabaseUrl, openDb } = setup();

    const result = await handler({ source: "savor.keepwarm" }, lambdaContext);

    expect(result).toEqual({ ok: true });
    expect(getDatabaseUrl).not.toHaveBeenCalled();
    expect(openDb).not.toHaveBeenCalled();
  });

  it("reads the database url once per container", async () => {
    const { call, getDatabaseUrl } = setup();

    await call(apiEvent({ path: "health.check" }));
    await call(apiEvent({ path: "health.check" }));

    expect(getDatabaseUrl).toHaveBeenCalledTimes(1);
  });

  it("reads the database url again after a failed read", async () => {
    const { call, getDatabaseUrl } = setup();
    getDatabaseUrl.mockRejectedValueOnce(new Error("secret unavailable"));

    await expect(call(apiEvent({ path: "health.check" }))).rejects.toThrow(
      "secret unavailable",
    );
    const health = await call(apiEvent({ path: "health.check" }));

    expect(health.status).toBe(200);
    expect(getDatabaseUrl).toHaveBeenCalledTimes(2);
  });

  it("opens and closes a pool for every request, also when one fails", async () => {
    const { call, openDb, closed } = setup();
    const user = newUserId();

    await call(apiEvent({ path: "health.check" }));
    const failed = await call(
      pushEvent(
        { moments: [moment(FAILING_TEXT)], photos: [] },
        { claims: { sub: user } },
      ),
    );

    expect(failed.status).toBe(500);
    expect(openDb).toHaveBeenCalledTimes(2);
    expect(closed).toHaveBeenCalledTimes(2);
  });
});
