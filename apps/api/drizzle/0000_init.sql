CREATE TABLE "moment_photos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"moment_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"deleted_at" bigint,
	"version" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"text" text NOT NULL,
	"kind" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"deleted_at" bigint,
	"version" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_sync_state" (
	"user_id" text PRIMARY KEY NOT NULL,
	"version" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "moment_photos_user_version_idx" ON "moment_photos" USING btree ("user_id","version");--> statement-breakpoint
CREATE INDEX "moments_user_version_idx" ON "moments" USING btree ("user_id","version");