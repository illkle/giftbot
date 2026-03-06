PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_giftwhale_feed_seen_messages` (
	`source` text DEFAULT 'sales' NOT NULL,
	`message_time` text NOT NULL,
	`nft_link` text NOT NULL,
	`first_seen_at` integer NOT NULL,
	PRIMARY KEY(`source`, `message_time`, `nft_link`)
);
--> statement-breakpoint
INSERT INTO `__new_giftwhale_feed_seen_messages`("source", "message_time", "nft_link", "first_seen_at") SELECT 'sales', "message_time", "nft_link", "first_seen_at" FROM `giftwhale_feed_seen_messages`;--> statement-breakpoint
DROP TABLE `giftwhale_feed_seen_messages`;--> statement-breakpoint
ALTER TABLE `__new_giftwhale_feed_seen_messages` RENAME TO `giftwhale_feed_seen_messages`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
