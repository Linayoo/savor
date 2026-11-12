CREATE TABLE "user_quota_usage" (
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"new_moments" integer DEFAULT 0 NOT NULL,
	"uploads" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "user_quota_usage_user_id_day_pk" PRIMARY KEY("user_id","day")
);
