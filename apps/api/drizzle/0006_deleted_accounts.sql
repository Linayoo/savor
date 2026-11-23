CREATE TABLE "deleted_accounts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"deleted_at" bigint NOT NULL,
	"finished_at" bigint
);
