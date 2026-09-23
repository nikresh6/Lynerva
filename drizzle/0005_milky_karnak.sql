CREATE TABLE `moneyline_source_weight_history` (
	`id` text PRIMARY KEY NOT NULL,
	`season` integer NOT NULL,
	`effective_week` integer NOT NULL,
	`source` text NOT NULL,
	`weight` real NOT NULL,
	`prior_weight` real NOT NULL,
	`sample_size` integer NOT NULL,
	`brier_score` real,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `moneyline_source_weight_unique` ON `moneyline_source_weight_history` (`season`,`effective_week`,`source`);--> statement-breakpoint
CREATE INDEX `moneyline_source_weight_lookup_idx` ON `moneyline_source_weight_history` (`season`,`effective_week`);