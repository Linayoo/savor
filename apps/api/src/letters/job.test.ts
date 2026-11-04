import type { MomentKind } from "@savor/shared";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { newUserId, testDb } from "../../test/db";
import { letterSettings, letters, moments } from "../db/schema";
import { previousMonth, runLetters } from "./job";
import type { LetterCheck } from "./prompt";
import type { LetterWriter } from "./writer";

const db = testDb();

// Each test writes October of its own year, so letters from one test never
// meet another's. Users other test files turned letters on for have no
// moments then, so they never reach the writer.
let nextYear = 2050;
function october() {
  const year = nextYear++;
  return {
    month: `${year}-10`,
    // Midday UTC: the same date in every zone used here
    day: (day: number) => Date.UTC(year, 9, day, 12),
    // 08:00 in Zurich on that day of November, when the schedule runs
    runOn: (day: number) => Date.UTC(year, 10, day, 7),
  };
}

const letterBody = (marker = "") =>
  `Dear you, ${marker} ${Array.from({ length: 120 }, () => "light").join(" ")}\n\nSavor`;

// Writes a letter for every call unless told otherwise, and keeps what it was given
class FakeWriter implements LetterWriter {
  model = "fake-model";
  calls: Parameters<LetterWriter["write"]>[0][] = [];
  private results: (LetterCheck | Error)[] = [];

  next(...results: (LetterCheck | Error)[]) {
    this.results.push(...results);
  }

  async write(input: Parameters<LetterWriter["write"]>[0]) {
    this.calls.push(input);
    const result = this.results.shift() ?? {
      ok: true as const,
      body: letterBody(),
      inputTokens: 1000,
      outputTokens: 200,
    };
    if (result instanceof Error) throw result;
    return result;
  }
}

async function user({
  enabled = true,
  timeZone = "Europe/Zurich",
}: { enabled?: boolean; timeZone?: string } = {}) {
  const userId = newUserId();
  await db
    .insert(letterSettings)
    .values({ userId, enabled, timeZone, updatedAt: 0 });
  return userId;
}

async function keep(
  userId: string,
  createdAt: number,
  {
    text = "Ramen with Ana",
    kind = "meal",
    deletedAt = null,
  }: {
    text?: string;
    kind?: MomentKind | null;
    deletedAt?: number | null;
  } = {},
) {
  await db.insert(moments).values({
    id: randomUUID(),
    userId,
    text,
    kind,
    createdAt,
    updatedAt: createdAt,
    deletedAt,
    version: 1,
  });
}

const stored = (userId: string) =>
  db.select().from(letters).where(eq(letters.userId, userId));

const run = (
  writer: LetterWriter,
  now: number,
  options: { month?: string; log?: (line: object) => void } = {},
) => runLetters({ db, writer, now, log: () => undefined, ...options });

describe("previousMonth", () => {
  it.each([
    [Date.UTC(2026, 10, 1, 7), "2026-10"],
    [Date.UTC(2027, 0, 1, 7), "2026-12"],
    // 00:30 on 1 December in Zurich, still November in UTC
    [Date.UTC(2026, 10, 30, 23, 30), "2026-11"],
  ])("at %d in Zurich is %s", (now, month) => {
    expect(previousMonth(now)).toBe(month);
  });
});

describe("runLetters", () => {
  it("writes exactly one letter for a month with 3 moments, from their dates, kinds and words", async () => {
    const { month, day, runOn } = october();
    const userId = await user();
    await keep(userId, day(3), { text: "Ramen with Ana" });
    await keep(userId, day(12), { text: "Finished Stoner", kind: "book" });
    await keep(userId, day(20), { text: "Fog", kind: null });
    const writer = new FakeWriter();

    await run(writer, runOn(1), { month });

    expect(writer.calls).toEqual([
      {
        month,
        timeZone: "Europe/Zurich",
        moments: [
          { createdAt: day(20), kind: null, text: "Fog" },
          { createdAt: day(12), kind: "book", text: "Finished Stoner" },
          { createdAt: day(3), kind: "meal", text: "Ramen with Ana" },
        ],
      },
    ]);
    expect(await stored(userId)).toEqual([
      {
        id: expect.any(String),
        userId,
        month,
        body: letterBody(),
        model: "fake-model",
        inputTokens: 1000,
        outputTokens: 200,
        createdAt: runOn(1),
      },
    ]);
  });

  it("writes no letter for fewer than 3 moments", async () => {
    const { month, day, runOn } = october();
    const userId = await user();
    await keep(userId, day(3));
    await keep(userId, day(4));
    const writer = new FakeWriter();

    await run(writer, runOn(1), { month });

    expect(writer.calls).toEqual([]);
    expect(await stored(userId)).toEqual([]);
  });

  it("writes no letter when letters are off, or were never turned on", async () => {
    const { month, day, runOn } = october();
    const off = await user({ enabled: false });
    const never = newUserId();
    for (const userId of [off, never]) {
      for (const d of [3, 4, 5]) await keep(userId, day(d));
    }
    const writer = new FakeWriter();

    await run(writer, runOn(1), { month });

    expect(writer.calls).toEqual([]);
    expect([...(await stored(off)), ...(await stored(never))]).toEqual([]);
  });

  it("counts moments near midnight in the month of the person's time zone", async () => {
    const month = "2040-10";
    const userId = await user({ timeZone: "Europe/Zurich" });
    // 23:30 on 30 September, CEST
    await keep(userId, Date.UTC(2040, 8, 30, 21, 30), { text: "September" });
    // 00:30 on 1 October, CEST
    await keep(userId, Date.UTC(2040, 8, 30, 22, 30), { text: "First" });
    await keep(userId, Date.UTC(2040, 9, 15, 12), { text: "Middle" });
    // 23:30 on 31 October, CET
    await keep(userId, Date.UTC(2040, 9, 31, 22, 30), { text: "Last" });
    // 00:30 on 1 November, CET
    await keep(userId, Date.UTC(2040, 9, 31, 23, 30), { text: "November" });
    const writer = new FakeWriter();

    await run(writer, Date.UTC(2040, 10, 1, 7), { month });

    expect(writer.calls[0].moments.map((m) => m.text)).toEqual([
      "Last",
      "Middle",
      "First",
    ]);
  });

  it("waits until the month has ended in the person's time zone", async () => {
    const month = "2041-10";
    const userId = await user({ timeZone: "Pacific/Honolulu" });
    await keep(userId, Date.UTC(2041, 9, 3, 12));
    await keep(userId, Date.UTC(2041, 9, 4, 12));
    // 23:30 on 31 October in Honolulu, 09:30 on 1 November in UTC
    await keep(userId, Date.UTC(2041, 10, 1, 9, 30), { text: "Late" });
    const writer = new FakeWriter();

    // 08:00 on the 1st in Zurich is 21:00 on 31 October in Honolulu
    const first = await run(writer, Date.UTC(2041, 10, 1, 7), { month });

    expect(writer.calls).toEqual([]);
    expect(await stored(userId)).toEqual([]);
    expect(first.skipped.notYet).toBeGreaterThanOrEqual(1);

    await run(writer, Date.UTC(2041, 10, 2, 7), { month });

    expect(writer.calls).toHaveLength(1);
    expect(writer.calls[0].moments.map((m) => m.text)).toContain("Late");
    expect(await stored(userId)).toHaveLength(1);
  });

  it("never writes a second letter for the same month", async () => {
    const { month, day, runOn } = october();
    const userId = await user();
    for (const d of [3, 4, 5]) await keep(userId, day(d));
    const writer = new FakeWriter();
    await run(writer, runOn(1), { month });

    await run(writer, runOn(2), { month });
    await run(writer, runOn(3), { month });

    expect(writer.calls).toHaveLength(1);
    expect(await stored(userId)).toHaveLength(1);
  });

  it("keeps writing for others when one fails, and retries the failed one on the next run", async () => {
    const { month, day, runOn } = october();
    const [thrown, refused, fine] = [await user(), await user(), await user()];
    for (const userId of [thrown, refused, fine]) {
      for (const d of [3, 4, 5]) await keep(userId, day(d));
    }
    const writer = new FakeWriter();
    // Users are written in id order
    const order = [thrown, refused, fine].sort();
    const results = new Map<string, LetterCheck | Error>([
      [thrown, new Error("Bedrock unreachable")],
      [refused, { ok: false, reason: "too_short" }],
    ]);
    writer.next(
      ...order.map(
        (userId) =>
          results.get(userId) ?? {
            ok: true as const,
            body: letterBody(),
            inputTokens: 1000,
            outputTokens: 200,
          },
      ),
    );

    const summary = await run(writer, runOn(1), { month });

    expect(await stored(thrown)).toEqual([]);
    expect(await stored(refused)).toEqual([]);
    expect(await stored(fine)).toHaveLength(1);
    expect(summary).toMatchObject({
      written: 1,
      failed: { error: 1, too_short: 1 },
    });

    await run(writer, runOn(2), { month });

    expect(await stored(thrown)).toHaveLength(1);
    expect(await stored(refused)).toHaveLength(1);
    expect(writer.calls).toHaveLength(5);
  });

  it("never sends deleted moments, other months' or other people's", async () => {
    const { month, day, runOn } = october();
    const userId = await user();
    const someoneElse = await user();
    for (const d of [3, 4, 5]) await keep(userId, day(d), { text: "Mine" });
    await keep(userId, day(6), { text: "Deleted", deletedAt: day(7) });
    await keep(userId, Date.UTC(2000, 0, 1), { text: "Long ago" });
    await keep(someoneElse, day(8), { text: "Theirs" });
    const writer = new FakeWriter();

    await run(writer, runOn(1), { month });

    expect(writer.calls).toHaveLength(1);
    expect(writer.calls[0].moments.map((m) => m.text)).toEqual([
      "Mine",
      "Mine",
      "Mine",
    ]);
  });

  it("sends at most the 150 most recent moments", async () => {
    const { month, runOn } = october();
    const userId = await user();
    const start = Date.UTC(Number(month.slice(0, 4)), 9, 2);
    for (let i = 0; i < 160; i++) {
      await keep(userId, start + i * 60_000, { text: `Moment ${i}` });
    }
    const writer = new FakeWriter();

    await run(writer, runOn(1), { month });

    const sent = writer.calls[0].moments.map((m) => m.text);
    expect(sent).toHaveLength(150);
    expect(sent).toContain("Moment 159");
    expect(sent).toContain("Moment 10");
    expect(sent).not.toContain("Moment 9");
  });

  it("logs counts and token totals, never a moment's words or a letter", async () => {
    const { month, day, runOn } = october();
    const [a, b, failing] = [await user(), await user(), await user()];
    for (const userId of [a, b, failing]) {
      for (const d of [3, 4, 5]) {
        await keep(userId, day(d), { text: "MOMENT-MARKER" });
      }
    }
    const writer = new FakeWriter();
    const order = [a, b, failing].sort();
    writer.next(
      ...order.map((userId) =>
        userId === failing
          ? new Error("Failed on MOMENT-MARKER")
          : {
              ok: true as const,
              body: letterBody("LETTER-MARKER"),
              inputTokens: 1000,
              outputTokens: 200,
            },
      ),
    );
    const lines: object[] = [];

    const summary = await run(writer, runOn(1), {
      month,
      log: (line) => lines.push(line),
    });

    const logged = JSON.stringify(lines);
    expect(logged).not.toContain("MOMENT-MARKER");
    expect(logged).not.toContain("LETTER-MARKER");
    expect(lines).toContainEqual({
      event: "letter_failed",
      month,
      userId: failing,
      reason: "error",
      error: "Error",
    });
    expect(lines.at(-1)).toEqual({ event: "letters_done", ...summary });
    expect(summary).toEqual({
      month,
      users: expect.any(Number),
      written: 2,
      skipped: {
        notYet: expect.any(Number),
        tooFew: expect.any(Number),
        already: 0,
      },
      failed: { error: 1 },
      inputTokens: 2000,
      outputTokens: 400,
    });
    expect(summary.users).toBeGreaterThanOrEqual(3);
  });

  it("writes for the month before the run in Zurich when none is given", async () => {
    const { month, day, runOn } = october();
    const userId = await user();
    for (const d of [3, 4, 5]) await keep(userId, day(d));
    const writer = new FakeWriter();

    const summary = await run(writer, runOn(1));

    expect(summary.month).toBe(month);
    expect(await stored(userId)).toHaveLength(1);
  });
});
