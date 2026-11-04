import { z } from "zod";

// The monthly letter (spec 007)

// An IANA zone the runtime knows, as the phone reports it
export const timeZoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(
    (zone) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: zone });
        return true;
      } catch {
        return false;
      }
    },
    { message: "Not an IANA time zone" },
  );

// A calendar month, YYYY-MM
export const letterMonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, { message: "Not a month (YYYY-MM)" });
export type LetterMonth = z.infer<typeof letterMonthSchema>;

// No time zone until letters are turned on for the first time
export const letterSettingsSchema = z.object({
  enabled: z.boolean(),
  timeZone: timeZoneSchema.nullable(),
});
export type LetterSettings = z.infer<typeof letterSettingsSchema>;

export const setLetterSettingsInputSchema = z.object({
  enabled: z.boolean(),
  timeZone: timeZoneSchema,
});
export type SetLetterSettingsInput = z.infer<
  typeof setLetterSettingsInputSchema
>;

export const letterSchema = z.object({
  id: z.uuid(),
  month: letterMonthSchema,
  body: z.string(),
  createdAt: z.int().min(0),
});
export type Letter = z.infer<typeof letterSchema>;

// Newest month first
export const listLettersOutputSchema = z.object({
  letters: z.array(letterSchema),
});
export type ListLettersOutput = z.infer<typeof listLettersOutputSchema>;
