CREATE TABLE `watchlist_quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`price` real NOT NULL,
	`currency` text NOT NULL,
	`as_of` integer NOT NULL,
	`source` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watchlist_quotes_asset_idx` ON `watchlist_quotes` (`asset_id`);--> statement-breakpoint
CREATE TABLE `price_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`kind` text NOT NULL,
	`threshold` real NOT NULL,
	`notify_telegram` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'armed' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`last_triggered_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `price_alerts_asset_idx` ON `price_alerts` (`asset_id`);--> statement-breakpoint
CREATE TABLE `alert_events` (
	`id` text PRIMARY KEY NOT NULL,
	`alert_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`kind` text NOT NULL,
	`threshold` real NOT NULL,
	`price_at_trigger` real NOT NULL,
	`currency` text NOT NULL,
	`triggered_at` integer NOT NULL,
	`acknowledged_at` integer,
	`telegram_sent` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`alert_id`) REFERENCES `price_alerts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `alert_events_ack_idx` ON `alert_events` (`acknowledged_at`);--> statement-breakpoint
ALTER TABLE `assets` ADD `is_watchlisted` integer DEFAULT false NOT NULL;