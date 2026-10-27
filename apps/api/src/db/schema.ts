import type { MomentKind } from "@savor/shared";
import {
  bigint,
  index,
  integer,
  pgTable,
  text,
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
  },
  (t) => [index("moment_photos_user_version_idx").on(t.userId, t.version)],
);

export const userSyncState = pgTable("user_sync_state", {
  userId: text("user_id").primaryKey(),
  version: ms("version").notNull(),
});
