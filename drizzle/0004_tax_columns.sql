ALTER TABLE `accounts` ADD `country_code` text;--> statement-breakpoint
ALTER TABLE `assets` ADD `asset_class_tax` text;--> statement-breakpoint
ALTER TABLE `asset_transactions` ADD `source_country` text;--> statement-breakpoint
ALTER TABLE `asset_transactions` ADD `is_listed` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `asset_transactions` ADD `withholding_tax_destination` real;