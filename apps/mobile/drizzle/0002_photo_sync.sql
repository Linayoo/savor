PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_moment_photos` (
	`id` text PRIMARY KEY NOT NULL,
	`moment_id` text NOT NULL,
	`file_name` text,
	`position` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`pending` integer DEFAULT 1 NOT NULL,
	`upload_state` text DEFAULT 'local' NOT NULL,
	`uploaded_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_moment_photos`("id", "moment_id", "file_name", "position", "created_at", "updated_at", "deleted_at") SELECT "id", "moment_id", "file_name", "position", "created_at", "updated_at", "deleted_at" FROM `moment_photos`;--> statement-breakpoint
DROP TABLE `moment_photos`;--> statement-breakpoint
ALTER TABLE `__new_moment_photos` RENAME TO `moment_photos`;--> statement-breakpoint
PRAGMA foreign_keys=ON;