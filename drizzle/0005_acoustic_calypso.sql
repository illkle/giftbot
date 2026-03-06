ALTER TABLE `telegram_chats` ADD `watch_mode` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `telegram_chats` SET `watch_mode` = CASE WHEN `is_active` = 1 THEN 'sales' ELSE '' END;--> statement-breakpoint
ALTER TABLE `telegram_chats` DROP COLUMN `is_active`;
