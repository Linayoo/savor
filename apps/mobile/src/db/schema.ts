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
  },
  (t) => [index("moments_timeline_idx").on(t.deletedAt, t.createdAt)],
);

export const momentPhotos = sqliteTable("moment_photos", {
  id: text("id").primaryKey(),
  momentId: text("moment_id")
    .notNull()
    .references(() => moments.id),
  fileName: text("file_name").notNull(),
  position: integer("position").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  deletedAt: integer("deleted_at"),
});

// App state that must change in the same transaction as data
export const appMeta = sqliteTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
