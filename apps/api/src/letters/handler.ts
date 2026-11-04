import { letterMonthSchema } from "@savor/shared";
import { z } from "zod";
import type { Db } from "../db/client";
import { runLetters } from "./job";
import type { LetterWriter } from "./writer";

// The schedule sends { source: "savor.letters" }; a manual invoke may add the
// month to write
const eventSchema = z.object({ month: letterMonthSchema.optional() });

export type LettersHandlerDeps = {
  getDatabaseUrl: () => Promise<string>;
  createDb: (url: string) => { db: Db; close: () => Promise<void> };
  writer: LetterWriter;
  now: () => number;
  log?: (line: object) => void;
};

export function createLettersHandler({
  getDatabaseUrl,
  createDb,
  writer,
  now,
  log,
}: LettersHandlerDeps) {
  return async (event: unknown) => {
    const { month } = eventSchema.parse(event ?? {});
    const { db, close } = createDb(await getDatabaseUrl());
    try {
      return await runLetters({ db, writer, now: now(), month, log });
    } finally {
      await close();
    }
  };
}
