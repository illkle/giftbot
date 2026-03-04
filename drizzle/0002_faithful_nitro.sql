CREATE TABLE `giftwhale_feed_seen_messages` (
	`message_time` text NOT NULL,
	`nft_link` text NOT NULL,
	`first_seen_at` integer NOT NULL,
	PRIMARY KEY(`message_time`, `nft_link`)
);
