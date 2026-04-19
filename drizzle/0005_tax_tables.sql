CREATE TABLE `tax_lots` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`account_id` text NOT NULL,
	`origin_transaction_id` text NOT NULL,
	`acquired_at` integer NOT NULL,
	`original_qty` real NOT NULL,
	`remaining_qty` real NOT NULL,
	`unit_cost_eur` real NOT NULL,
	`deferred_loss_added_eur` real DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`origin_transaction_id`) REFERENCES `asset_transactions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tax_lots_asset_acquired_idx` ON `tax_lots` (`asset_id`,`acquired_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `tax_lots_origin_idx` ON `tax_lots` (`origin_transaction_id`);--> statement-breakpoint
CREATE TABLE `tax_lot_consumptions` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_transaction_id` text NOT NULL,
	`lot_id` text NOT NULL,
	`qty_consumed` real NOT NULL,
	`cost_basis_eur` real NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`sale_transaction_id`) REFERENCES `asset_transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lot_id`) REFERENCES `tax_lots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tax_lot_consumptions_sale_idx` ON `tax_lot_consumptions` (`sale_transaction_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tax_lot_consumptions_unique_pair` ON `tax_lot_consumptions` (`sale_transaction_id`,`lot_id`);--> statement-breakpoint
CREATE TABLE `tax_wash_sale_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_transaction_id` text NOT NULL,
	`absorbing_lot_id` text NOT NULL,
	`disallowed_loss_eur` real NOT NULL,
	`window_days` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`sale_transaction_id`) REFERENCES `asset_transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`absorbing_lot_id`) REFERENCES `tax_lots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tax_wash_sale_adjustments_sale_idx` ON `tax_wash_sale_adjustments` (`sale_transaction_id`);--> statement-breakpoint
CREATE TABLE `tax_year_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`year` integer NOT NULL,
	`sealed_at` integer NOT NULL,
	`payload_json` text NOT NULL,
	`rendered_pdf_path` text,
	`rendered_csv_paths` text,
	`notes` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tax_year_snapshots_year_idx` ON `tax_year_snapshots` (`year`);