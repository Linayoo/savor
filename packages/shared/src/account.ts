import { z } from "zod";

// Account deletion (spec 010)

export const deleteAccountOutputSchema = z.object({ deleted: z.literal(true) });
export type DeleteAccountOutput = z.infer<typeof deleteAccountOutputSchema>;

// A Cognito sub, as the phone keeps it for its owner
export const wasDeletedInputSchema = z.object({
  userId: z.string().min(1).max(128),
});
export const wasDeletedOutputSchema = z.object({ deleted: z.boolean() });
export type WasDeletedOutput = z.infer<typeof wasDeletedOutputSchema>;
