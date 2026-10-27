import { z } from "zod";
import { momentChangeSchema, photoChangeSchema } from "./moments";

export const MAX_PUSH_ITEMS = 100;

export const pushInputSchema = z
  .object({
    moments: z.array(momentChangeSchema),
    photos: z.array(photoChangeSchema),
  })
  .refine(
    (input) => input.moments.length + input.photos.length <= MAX_PUSH_ITEMS,
    {
      message: `A push holds at most ${MAX_PUSH_ITEMS} moments and photos in total`,
    },
  );
export type PushInput = z.infer<typeof pushInputSchema>;

export const pushOutputSchema = z.object({ version: z.int().min(0) });
export type PushOutput = z.infer<typeof pushOutputSchema>;

export const pullInputSchema = z.object({
  sinceVersion: z.int().min(0),
  limit: z.int().min(1).max(500).default(200),
});
export type PullInput = z.input<typeof pullInputSchema>;

const versioned = { version: z.int().min(1) };

export const pullOutputSchema = z.object({
  moments: z.array(momentChangeSchema.extend(versioned)),
  photos: z.array(photoChangeSchema.extend(versioned)),
  version: z.int().min(0),
  hasMore: z.boolean(),
});
export type PullOutput = z.infer<typeof pullOutputSchema>;
