ALTER TABLE `asset_positions` ADD `average_cost_native` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `asset_positions` ADD `total_cost_native` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `asset_positions` ADD `total_cost_eur` real DEFAULT 0 NOT NULL;