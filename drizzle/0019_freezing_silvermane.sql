CREATE TABLE `advisor_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `advisor_conversations_updated_at_idx` ON `advisor_conversations` (`updated_at`);--> statement-breakpoint
CREATE TABLE `advisor_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `advisor_conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `advisor_messages_conversation_idx` ON `advisor_messages` (`conversation_id`,`created_at`);