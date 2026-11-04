import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { MomentKind } from "../kinds";

// Times are ms since epoch. Rows are never removed; deletes set deleted_at.

export const moments = sqliteTable(
  "moments",
  {
    id: text("id").primaryKey(),
    text: text("text").notNull(),
    kind: text("kind").$type<MomentKind>(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
    // 1 while the row has local changes the server hasn't accepted (spec 005)
    pending: integer("pending").notNull().default(1),
  },
  (t) => [index("moments_timeline_idx").on(t.deletedAt, t.createdAt)],
);

// Photo records sync like moments (spec 006); their files follow. No foreign
// key: a pulled photo can arrive before its moment.
// - local: the file is here and not uploaded yet
// - uploaded: the file is here and on the server
// - remote: known from a pull, the file isn't here yet (no file_name)
export type UploadState = "local" | "uploaded" | "remote";

export const momentPhotos = sqliteTable("moment_photos", {
  id: text("id").primaryKey(),
  momentId: text("moment_id").notNull(),
  fileName: text("file_name"),
  position: integer("position").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  deletedAt: integer("deleted_at"),
  pending: integer("pending").notNull().default(1),
  uploadState: text("upload_state")
    .$type<UploadState>()
    .notNull()
    .default("local"),
  // Copied from pulls: when the server got the file, if it has
  uploadedAt: integer("uploaded_at"),
});

// App state that must change in the same transaction as data
export const appMeta = sqliteTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

// The monthly letters (spec 007): a read-only copy of the server's, replaced
// from letters.list and cleared on sign-out
export const letters = sqliteTable("letters", {
  id: text("id").primaryKey(),
  // YYYY-MM
  month: text("month").notNull(),
  body: text("body").notNull(),
  createdAt: integer("created_at").notNull(),
});
