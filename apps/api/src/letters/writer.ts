import type { LetterMonth } from "@savor/shared";
import type { LetterCheck, LetterMoment } from "./prompt";

// Writes one person's letter for a month. Bedrock in AWS (ADR 0007), a fake
// in tests.
export type LetterWriter = {
  model: string;
  write(input: {
    month: LetterMonth;
    timeZone: string;
    moments: LetterMoment[];
  }): Promise<LetterCheck>;
};
