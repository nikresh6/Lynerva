CREATE TABLE `source_projections` (
	`id` text PRIMARY KEY NOT NULL,
	`season` integer NOT NULL,
	`week` integer NOT NULL,
	`player_name` text NOT NULL,
	`player_key` text NOT NULL,
	`statistic` text NOT NULL,
	`source` text NOT NULL,
	`projected_value` real NOT NULL,
	`captured_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_projection_unique` ON `source_projections` (`season`,`week`,`player_key`,`statistic`,`source`);
--> statement-breakpoint
CREATE INDEX `source_projection_stat_week_idx` ON `source_projections` (`season`,`week`,`statistic`);
--> statement-breakpoint
CREATE TABLE `source_projection_grades` (
	`projection_id` text PRIMARY KEY NOT NULL,
	`actual_value` real NOT NULL,
	`absolute_error` real NOT NULL,
	`squared_error` real NOT NULL,
	`graded_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`projection_id`) REFERENCES `source_projections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `source_projection_grades_time_idx` ON `source_projection_grades` (`graded_at`);
--> statement-breakpoint
CREATE TABLE `source_weight_history` (
	`id` text PRIMARY KEY NOT NULL,
	`season` integer NOT NULL,
	`effective_week` integer NOT NULL,
	`statistic` text NOT NULL,
	`source` text NOT NULL,
	`weight` real NOT NULL,
	`sample_size` integer NOT NULL,
	`mae` real,
	`recent_mae` real,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_weight_unique` ON `source_weight_history` (`season`,`effective_week`,`statistic`,`source`);
--> statement-breakpoint
CREATE INDEX `source_weight_lookup_idx` ON `source_weight_history` (`season`,`statistic`,`effective_week`);