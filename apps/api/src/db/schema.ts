import type { MomentKind } from "@savor/shared";
import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// Times are ms since epoch from the device. Versions count per user and come
// from user_sync_state. Read as numbers, not strings; both stay below 2^53.
const ms = (name: string) => bigint(name, { mode: "number" });

export const moments = pgTable(
  "moments",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id").notNull(),
    text: text("text").notNull(),
    kind: text("kind").$type<MomentKind>(),
    createdAt: ms("created_at").notNull(),
    updatedAt: ms("updated_at").notNull(),
    deletedAt: ms("deleted_at"),
    version: ms("version").notNull(),
  },
  (t) => [index("moments_user_version_idx").on(t.userId, t.version)],
);

// No foreign key to moments: a photo can arrive in a different push than its
// moment (spec 003)
export const momentPhotos = pgTable(
  "moment_photos",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id").notNull(),
    momentId: uuid("moment_id").notNull(),
    position: integer("position").notNull(),
    createdAt: ms("created_at").notNull(),
    updatedAt: ms("updated_at").notNull(),
    deletedAt: ms("deleted_at"),
    version: ms("version").notNull(),
    // Set by photos.confirmUpload once the file is in S3 (spec 006); pushes
    // never change it
    uploadedAt: ms("uploaded_at"),
  },
  (t) => [index("moment_photos_user_version_idx").on(t.userId, t.version)],
);

export const userSyncState = pgTable("user_sync_state", {
  userId: text("user_id").primaryKey(),
  version: ms("version").notNull(),
});

// The monthly letter (spec 007). No row until letters are first turned on:
// they're off. Turning them off keeps the time zone.
export const letterSettings = pgTable("letter_settings", {
  userId: text("user_id").primaryKey(),
  enabled: boolean("enabled").notNull(),
  timeZone: text("time_zone").notNull(),
  updatedAt: ms("updated_at").notNull(),
});

// Written by the letters job, never by the phone. One per user and month, so
// a rerun can't add a second.
export const letters = pgTable(
  "letters",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id").notNull(),
    // YYYY-MM, in the user's time zone
    month: text("month").notNull(),
    body: text("body").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    createdAt: ms("created_at").notNull(),
  },
  (t) => [unique("letters_user_month_unique").on(t.userId, t.month)],
);
