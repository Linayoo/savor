import { momentKindSchema } from "@savor/shared";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { LetterMoment } from "../src/letters/prompt";

// The sample moments file that letter-preview and seed-moments read:
//   [{ "date": "2026-10-04T13:00:00+02:00", "kind": "meal", "text": "..." }]
// The offset is required, so a date means the same instant on any computer.

const sampleSchema = z.array(
  z.object({
    date: z.iso.datetime({ offset: true }),
    kind: momentKindSchema.nullable().default(null),
    text: z.string(),
  }),
);

export async function readSamples(path: string): Promise<LetterMoment[]> {
  const samples = sampleSchema.parse(JSON.parse(await readFile(path, "utf8")));
  return samples.map(({ date, kind, text }) => ({
    createdAt: Date.parse(date),
    kind,
    text,
  }));
}
