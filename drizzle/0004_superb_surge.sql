PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_telegram_chats` (
	`chat_id` text NOT NULL,
	`topic_id` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`gift_filter_config` text,
	`first_seen_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`chat_id`, `topic_id`)
);
--> statement-breakpoint
INSERT INTO `__new_telegram_chats`("chat_id", "topic_id", "is_active", "gift_filter_config", "first_seen_at", "updated_at") SELECT "chat_id", 0, "is_active", "gift_filter_config", "first_seen_at", "updated_at" FROM `telegram_chats`;--> statement-breakpoint
DROP TABLE `telegram_chats`;--> statement-breakpoint
ALTER TABLE `__new_telegram_chats` RENAME TO `telegram_chats`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
