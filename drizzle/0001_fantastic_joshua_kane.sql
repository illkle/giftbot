CREATE TABLE `telegram_chats` (
	`chat_id` text PRIMARY KEY NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`first_seen_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
