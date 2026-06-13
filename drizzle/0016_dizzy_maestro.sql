CREATE TABLE `asset_sector_weightings` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`sector` text NOT NULL,
	`weight` real NOT NULL,
	`source` text NOT NULL,
	`fetched_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `asset_sector_weightings_asset_sector_idx` ON `asset_sector_weightings` (`asset_id`,`sector`);