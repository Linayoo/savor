import { describe, expect, it, vi } from "vitest";
import { TEST_DATABASE_URL } from "../../test/env";
import { createDb } from "../db/client";
import { createLettersHandler } from "./handler";
import type { LetterWriter } from "./writer";

const writer: LetterWriter = {
  model: "fake-model",
  write: async () => ({ ok: false, reason: "empty" }),
};

function setup() {
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
  const handler = createLettersHandler({
    getDatabaseUrl: async () => TEST_DATABASE_URL,
    createDb: openDb,
    writer,
    now: () => Date.UTC(2060, 10, 1, 7),
    log: () => undefined,
  });
  return { handler, openDb, closed };
}

describe("the letters handler", () => {
  it("writes the month before the run on the schedule's call, then closes its pool", async () => {
    const { handler, closed } = setup();

    const summary = await handler({ source: "savor.letters" });

    expect(summary).toMatchObject({ month: "2060-10", written: 0 });
    expect(closed).toHaveBeenCalledOnce();
  });

  it("writes the month given in a manual invoke", async () => {
    const { handler } = setup();

    expect(
      await handler({ source: "savor.letters", month: "2060-09" }),
    ).toMatchObject({ month: "2060-09" });
  });

  it("refuses a month that isn't YYYY-MM before touching the database", async () => {
    const { handler, openDb } = setup();

    await expect(
      handler({ source: "savor.letters", month: "October" }),
    ).rejects.toThrow();
    expect(openDb).not.toHaveBeenCalled();
  });

  it("closes its pool when the run fails", async () => {
    const closed = vi.fn();
    const failing = createLettersHandler({
      getDatabaseUrl: async () => TEST_DATABASE_URL,
      createDb: () => ({
        db: {
          select: () => {
            throw new Error("database down");
          },
        } as never,
        close: async () => closed(),
      }),
      writer,
      now: Date.now,
    });

    await expect(failing({ source: "savor.letters" })).rejects.toThrow(
      "database down",
    );
    expect(closed).toHaveBeenCalledOnce();
  });
});
