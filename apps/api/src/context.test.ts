import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { testDb } from "../test/db";
import { createContextFactory, devUserId } from "./context";

const headers = (h: Record<string, string>) => h as IncomingMessage["headers"];

describe("devUserId", () => {
  it("reads x-dev-user-id when NODE_ENV is development", () => {
    expect(devUserId(headers({ "x-dev-user-id": "ana" }), "development")).toBe(
      "ana",
    );
  });

  it.each(["production", "test", undefined])(
    "ignores x-dev-user-id when NODE_ENV is %s",
    (env) => {
      expect(devUserId(headers({ "x-dev-user-id": "ana" }), env)).toBeNull();
    },
  );

  it("treats a missing or empty header as no user", () => {
    expect(devUserId(headers({}), "development")).toBeNull();
    expect(
      devUserId(headers({ "x-dev-user-id": " " }), "development"),
    ).toBeNull();
  });
});

describe("createContextFactory", () => {
  const db = testDb();
  const req = { headers: headers({ "x-dev-user-id": "ana" }) };

  it("gives requests the db and the dev user in development", () => {
    const createContext = createContextFactory(db, "development");

    expect(createContext({ req } as never)).toEqual({ db, userId: "ana" });
  });

  it("ignores the header under the environment the tests run in", () => {
    expect(process.env.NODE_ENV).toBe("test");
    const createContext = createContextFactory(db);

    expect(createContext({ req } as never)).toEqual({ db, userId: null });
  });
});
