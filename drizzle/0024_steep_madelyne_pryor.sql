CREATE TABLE `discover_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`symbol` text NOT NULL,
	`name` text NOT NULL,
	`criterion` text NOT NULL,
	`thesis` text NOT NULL,
	`source_url` text,
	`detail` text NOT NULL,
	`price` real,
	`currency` text,
	`dma200` real,
	`pct_vs_dma200` real,
	`drawdown_30d` real,
	`momentum_20d` real,
	`pct_below_52w_high` real,
	`sector` text,
	`sector_strength_3m` real,
	`own_return_3m` real,
	`status` text NOT NULL,
	`discovered_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `discover_candidates_run_idx` ON `discover_candidates` (`run_id`);