CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`account_type` text NOT NULL,
	`opening_balance_eur` real DEFAULT 0 NOT NULL,
	`current_cash_balance_eur` real DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`asset_type` text NOT NULL,
	`subtype` text,
	`symbol` text,
	`ticker` text,
	`isin` text,
	`exchange` text,
	`provider_symbol` text,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assets_isin_idx` ON `assets` (`isin`);--> statement-breakpoint
CREATE TABLE `asset_positions` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`quantity` real DEFAULT 0 NOT NULL,
	`average_cost_eur` real DEFAULT 0 NOT NULL,
	`manual_price` real,
	`manual_price_as_of` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `asset_positions_asset_idx` ON `asset_positions` (`asset_id`);--> statement-breakpoint
CREATE TABLE `asset_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`transaction_type` text NOT NULL,
	`traded_at` integer NOT NULL,
	`settlement_date` integer,
	`quantity` real NOT NULL,
	`unit_price` real NOT NULL,
	`trade_currency` text NOT NULL,
	`fx_rate_to_eur` real NOT NULL,
	`trade_gross_amount` real NOT NULL,
	`trade_gross_amount_eur` real NOT NULL,
	`cash_impact_eur` real NOT NULL,
	`fees_amount` real DEFAULT 0 NOT NULL,
	`fees_amount_eur` real DEFAULT 0 NOT NULL,
	`net_amount_eur` real NOT NULL,
	`dividend_gross` real,
	`dividend_net` real,
	`withholding_tax` real,
	`linked_transaction_id` text,
	`external_reference` text,
	`row_fingerprint` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`notes` text,
	`raw_payload` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `asset_transactions_account_idx` ON `asset_transactions` (`account_id`);--> statement-breakpoint
CREATE INDEX `asset_transactions_asset_idx` ON `asset_transactions` (`asset_id`);--> statement-breakpoint
CREATE INDEX `asset_transactions_traded_at_idx` ON `asset_transactions` (`traded_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `asset_transactions_fingerprint_idx` ON `asset_transactions` (`row_fingerprint`);--> statement-breakpoint
CREATE TABLE `account_cash_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`movement_type` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`value_date` integer,
	`native_amount` real NOT NULL,
	`currency` text NOT NULL,
	`fx_rate_to_eur` real NOT NULL,
	`cash_impact_eur` real NOT NULL,
	`external_reference` text,
	`row_fingerprint` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`description` text,
	`affects_cash_balance` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `account_cash_movements_account_idx` ON `account_cash_movements` (`account_id`);--> statement-breakpoint
CREATE INDEX `account_cash_movements_occurred_at_idx` ON `account_cash_movements` (`occurred_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `account_cash_movements_fingerprint_idx` ON `account_cash_movements` (`row_fingerprint`);--> statement-breakpoint
CREATE TABLE `daily_balances` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`balance_date` text NOT NULL,
	`balance_eur` real NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_balances_account_date_idx` ON `daily_balances` (`account_id`,`balance_date`);--> statement-breakpoint
CREATE TABLE `price_history` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`priced_at` integer NOT NULL,
	`priced_date_utc` text NOT NULL,
	`price` real NOT NULL,
	`source` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `price_history_symbol_date_idx` ON `price_history` (`symbol`,`priced_date_utc`);--> statement-breakpoint
CREATE TABLE `asset_valuations` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`valuation_date` text NOT NULL,
	`quantity` real NOT NULL,
	`unit_price_eur` real NOT NULL,
	`market_value_eur` real NOT NULL,
	`price_source` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `asset_valuations_asset_date_idx` ON `asset_valuations` (`asset_id`,`valuation_date`);--> statement-breakpoint
CREATE TABLE `fx_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`currency` text NOT NULL,
	`date` text NOT NULL,
	`rate_to_eur` real NOT NULL,
	`source` text DEFAULT 'yahoo_fx' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fx_rates_currency_date_idx` ON `fx_rates` (`currency`,`date`);--> statement-breakpoint
CREATE TABLE `transaction_import_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`import_id` text NOT NULL,
	`row_index` integer NOT NULL,
	`status` text NOT NULL,
	`row_fingerprint` text,
	`error_message` text,
	`asset_transaction_id` text,
	`cash_movement_id` text,
	`raw_payload` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`import_id`) REFERENCES `transaction_imports`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `transaction_import_rows_import_idx` ON `transaction_import_rows` (`import_id`);--> statement-breakpoint
CREATE TABLE `transaction_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`format` text NOT NULL,
	`filename` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`total_rows` integer DEFAULT 0 NOT NULL,
	`imported_rows` integer DEFAULT 0 NOT NULL,
	`duplicate_rows` integer DEFAULT 0 NOT NULL,
	`invalid_rows` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`actor_type` text DEFAULT 'user' NOT NULL,
	`source` text DEFAULT 'ui' NOT NULL,
	`summary` text,
	`previous_json` text,
	`next_json` text,
	`context_json` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_events_entity_idx` ON `audit_events` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_events_created_at_idx` ON `audit_events` (`created_at`);