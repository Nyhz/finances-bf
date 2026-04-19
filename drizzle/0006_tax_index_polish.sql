ALTER TABLE `tax_lots` ADD `updated_at` integer NOT NULL;--> statement-breakpoint
CREATE INDEX `tax_lot_consumptions_lot_idx` ON `tax_lot_consumptions` (`lot_id`);--> statement-breakpoint
CREATE INDEX `tax_wash_sale_adjustments_lot_idx` ON `tax_wash_sale_adjustments` (`absorbing_lot_id`);