import { z } from "zod";

// The kinds from spec 001. The app adds labels and icons; the order is the
// order of the chips.
export const MOMENT_KINDS = [
  "meal",
  "film",
  "book",
  "nature",
  "friends",
  "body",
  "phrase",
] as const;

export const momentKindSchema = z.enum(MOMENT_KINDS);
export type MomentKind = z.infer<typeof momentKindSchema>;

// Times are ms since epoch, set on the device
const time = z.int().min(0);

export const momentChangeSchema = z.object({
  id: z.uuid(),
  text: z.string().max(5000),
  kind: momentKindSchema.nullable(),
  createdAt: time,
  updatedAt: time,
  deletedAt: time.nullable(),
});
export type MomentChange = z.infer<typeof momentChangeSchema>;

// No file name: the server identifies a photo by its id
export const photoChangeSchema = z.object({
  id: z.uuid(),
  momentId: z.uuid(),
  // Matches the Postgres integer column
  position: z.int32().min(0),
  createdAt: time,
  updatedAt: time,
  deletedAt: time.nullable(),
});
export type PhotoChange = z.infer<typeof photoChangeSchema>;
