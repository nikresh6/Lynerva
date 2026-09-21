CREATE TABLE `weekly_scorecard_picks` (
	`id` text PRIMARY KEY NOT NULL,
	`season` integer NOT NULL,
	`week` integer NOT NULL,
	`rank` integer NOT NULL,
	`prediction_id` text NOT NULL,
	`locked_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`prediction_id`) REFERENCES `predictions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `weekly_scorecard_week_rank_unique` ON `weekly_scorecard_picks` (`season`,`week`,`rank`);
--> statement-breakpoint
CREATE UNIQUE INDEX `weekly_scorecard_prediction_unique` ON `weekly_scorecard_picks` (`prediction_id`);
--> statement-breakpoint
CREATE INDEX `weekly_scorecard_week_idx` ON `weekly_scorecard_picks` (`season`,`week`);