import type { LetterMonth } from "@savor/shared";
import { and, asc, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Db } from "../db/client";
import { letterSettings, letters, moments } from "../db/schema";
import { MAX_LETTER_MOMENTS } from "./prompt";
import type { LetterWriter } from "./writer";

// The monthly letter job (spec 007). The schedule runs it at 08:00 in Zurich
// on days 1, 2 and 3; each run writes the letters still missing, so the later
// days retry failures and pick up people whose month ended after the 1st.

const SCHEDULE_TIME_ZONE = "Europe/Zurich";
const MIN_MOMENTS = 3;

export type LettersSummary = {
  month: LetterMonth;
  users: number;
  written: number;
  skipped: { notYet: number; tooFew: number; already: number };
  failed: Record<string, number>;
  inputTokens: number;
  outputTokens: number;
};

// The month before `now` on the schedule's calendar
export function previousMonth(now: number): LetterMonth {
  const parts = new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "numeric",
    timeZone: SCHEDULE_TIME_ZONE,
  }).formatToParts(now);
  const part = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  const [year, month] = [part("year"), part("month")];
  return month === 1
    ? `${year - 1}-12`
    : `${year}-${String(month - 1).padStart(2, "0")}`;
}

const firstDayAfter = (month: LetterMonth) => {
  const [year, m] = month.split("-").map(Number);
  return m === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(m + 1).padStart(2, "0")}-01`;
};

// Midnight on a date in the user's time zone, in ms. Postgres knows the
// zones' rules, daylight saving included.
const midnightIn = (date: string) =>
  sql<number>`(extract(epoch from (${date}::timestamp at time zone ${letterSettings.timeZone})) * 1000)::bigint`.mapWith(
    Number,
  );

async function monthBounds(db: Db, userId: string, month: LetterMonth) {
  const [bounds] = await db
    .select({
      start: midnightIn(`${month}-01`),
      end: midnightIn(firstDayAfter(month)),
    })
    .from(letterSettings)
    .where(eq(letterSettings.userId, userId));
  return bounds;
}

// Only what the letter needs, of this user's moments still kept that month
const momentsOf = (db: Db, userId: string, start: number, end: number) =>
  db
    .select({
      createdAt: moments.createdAt,
      kind: moments.kind,
      text: moments.text,
    })
    .from(moments)
    .where(
      and(
        eq(moments.userId, userId),
        isNull(moments.deletedAt),
        gte(moments.createdAt, start),
        lt(moments.createdAt, end),
      ),
    )
    .orderBy(desc(moments.createdAt))
    .limit(MAX_LETTER_MOMENTS);

// Logs only counts, reasons and ids, never a moment's words or a letter
export async function runLetters({
  db,
  writer,
  now,
  month = previousMonth(now),
  log = (line) => console.log(JSON.stringify(line)),
}: {
  db: Db;
  writer: LetterWriter;
  now: number;
  month?: LetterMonth;
  log?: (line: object) => void;
}): Promise<LettersSummary> {
  const summary: LettersSummary = {
    month,
    users: 0,
    written: 0,
    skipped: { notYet: 0, tooFew: 0, already: 0 },
    failed: {},
    inputTokens: 0,
    outputTokens: 0,
  };
  const fail = (userId: string, reason: string, error?: string) => {
    summary.failed[reason] = (summary.failed[reason] ?? 0) + 1;
    log({
      event: "letter_failed",
      month,
      userId,
      reason,
      ...(error && { error }),
    });
  };

  // People with letters on and no letter yet for this month
  const users = await db
    .select({
      userId: letterSettings.userId,
      timeZone: letterSettings.timeZone,
    })
    .from(letterSettings)
    .leftJoin(
      letters,
      and(eq(letters.userId, letterSettings.userId), eq(letters.month, month)),
    )
    .where(and(eq(letterSettings.enabled, true), isNull(letters.id)))
    .orderBy(asc(letterSettings.userId));
  summary.users = users.length;

  for (const { userId, timeZone } of users) {
    try {
      const { start, end } = await monthBounds(db, userId, month);
      if (end > now) {
        summary.skipped.notYet++;
        continue;
      }
      const kept = await momentsOf(db, userId, start, end);
      if (kept.length < MIN_MOMENTS) {
        summary.skipped.tooFew++;
        continue;
      }

      const result = await writer.write({ month, timeZone, moments: kept });
      if (!result.ok) {
        fail(userId, result.reason);
        continue;
      }

      // A run that overlaps this one may have saved it first
      const saved = await db
        .insert(letters)
        .values({
          id: randomUUID(),
          userId,
          month,
          body: result.body,
          model: writer.model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          createdAt: now,
        })
        .onConflictDoNothing({ target: [letters.userId, letters.month] })
        .returning({ id: letters.id });
      if (saved.length === 0) {
        summary.skipped.already++;
        continue;
      }
      summary.written++;
      summary.inputTokens += result.inputTokens;
      summary.outputTokens += result.outputTokens;
    } catch (error) {
      // The error's name only: a message could quote what was sent
      fail(userId, "error", error instanceof Error ? error.name : "unknown");
    }
  }

  log({ event: "letters_done", ...summary });
  return summary;
}
