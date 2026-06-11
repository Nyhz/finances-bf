CREATE TABLE `objectives` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`target_pct` real NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `objectives_name_idx` ON `objectives` (`name`);--> statement-breakpoint
ALTER TABLE `assets` ADD `objective_id` text REFERENCES objectives(id);