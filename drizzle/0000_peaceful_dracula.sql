CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `account_provider_unique` ON `account` (`provider_id`,`account_id`);--> statement-breakpoint
CREATE TABLE `market_events` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text,
	`title` text NOT NULL,
	`starts_at` integer,
	`status` text DEFAULT 'open' NOT NULL,
	`home_team` text,
	`away_team` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `nfl_games`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `market_events_game_idx` ON `market_events` (`game_id`);--> statement-breakpoint
CREATE INDEX `market_events_status_idx` ON `market_events` (`status`,`starts_at`);--> statement-breakpoint
CREATE TABLE `market_listings` (
	`id` text PRIMARY KEY NOT NULL,
	`normalized_market_id` text,
	`platform` text NOT NULL,
	`platform_market_id` text NOT NULL,
	`platform_outcome_id` text,
	`event_title` text NOT NULL,
	`market_title` text NOT NULL,
	`outcome_label` text NOT NULL,
	`resolution_rules` text,
	`status` text NOT NULL,
	`is_live` integer DEFAULT false NOT NULL,
	`yes_bid_bps` integer,
	`yes_ask_bps` integer,
	`no_bid_bps` integer,
	`no_ask_bps` integer,
	`last_price_bps` integer,
	`liquidity_cents` integer,
	`volume_cents` integer,
	`closes_at` integer,
	`source_updated_at` integer NOT NULL,
	`fetched_at` integer NOT NULL,
	`raw_payload` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`normalized_market_id`) REFERENCES `normalized_markets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `market_listing_platform_unique` ON `market_listings` (`platform`,`platform_market_id`,`platform_outcome_id`);--> statement-breakpoint
CREATE INDEX `market_listing_open_idx` ON `market_listings` (`status`,`fetched_at`);--> statement-breakpoint
CREATE INDEX `market_listing_normalized_idx` ON `market_listings` (`normalized_market_id`);--> statement-breakpoint
CREATE INDEX `market_listing_platform_idx` ON `market_listings` (`platform`,`is_live`);--> statement-breakpoint
CREATE TABLE `market_price_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_id` text NOT NULL,
	`captured_at` integer NOT NULL,
	`yes_bid_bps` integer,
	`yes_ask_bps` integer,
	`no_bid_bps` integer,
	`no_ask_bps` integer,
	`liquidity_cents` integer,
	`volume_cents` integer,
	FOREIGN KEY (`listing_id`) REFERENCES `market_listings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `price_snapshot_listing_time_idx` ON `market_price_snapshots` (`listing_id`,`captured_at`);--> statement-breakpoint
CREATE TABLE `model_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`version` text NOT NULL,
	`family` text NOT NULL,
	`coefficients` text NOT NULL,
	`training_window_start` integer,
	`training_window_end` integer,
	`brier_score` real,
	`log_loss` real,
	`calibration_notes` text,
	`active` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `model_version_unique` ON `model_versions` (`name`,`version`);--> statement-breakpoint
CREATE INDEX `model_active_family_idx` ON `model_versions` (`active`,`family`);--> statement-breakpoint
CREATE TABLE `nfl_games` (
	`id` text PRIMARY KEY NOT NULL,
	`season` integer NOT NULL,
	`week` integer,
	`season_type` text DEFAULT 'REG' NOT NULL,
	`kickoff_at` integer NOT NULL,
	`home_team` text NOT NULL,
	`away_team` text NOT NULL,
	`home_score` integer,
	`away_score` integer,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`stadium` text,
	`roof` text,
	`surface` text,
	`espn_event_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `nfl_games_kickoff_idx` ON `nfl_games` (`kickoff_at`);--> statement-breakpoint
CREATE INDEX `nfl_games_status_idx` ON `nfl_games` (`status`);--> statement-breakpoint
CREATE INDEX `nfl_games_teams_idx` ON `nfl_games` (`home_team`,`away_team`);--> statement-breakpoint
CREATE TABLE `nfl_players` (
	`id` text PRIMARY KEY NOT NULL,
	`gsis_id` text,
	`full_name` text NOT NULL,
	`position` text,
	`team` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `nfl_players_gsis_unique` ON `nfl_players` (`gsis_id`);--> statement-breakpoint
CREATE INDEX `nfl_players_name_idx` ON `nfl_players` (`full_name`);--> statement-breakpoint
CREATE INDEX `nfl_players_team_idx` ON `nfl_players` (`team`);--> statement-breakpoint
CREATE TABLE `normalized_markets` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`game_id` text,
	`player_id` text,
	`league` text DEFAULT 'NFL' NOT NULL,
	`family` text NOT NULL,
	`statistic` text,
	`direction` text NOT NULL,
	`threshold` real,
	`outcome_label` text NOT NULL,
	`resolution_key` text NOT NULL,
	`settlement_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `market_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `nfl_games`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`player_id`) REFERENCES `nfl_players`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `normalized_market_resolution_unique` ON `normalized_markets` (`resolution_key`);--> statement-breakpoint
CREATE INDEX `normalized_market_game_idx` ON `normalized_markets` (`game_id`);--> statement-breakpoint
CREATE INDEX `normalized_market_player_idx` ON `normalized_markets` (`player_id`);--> statement-breakpoint
CREATE INDEX `normalized_market_family_idx` ON `normalized_markets` (`family`,`statistic`);--> statement-breakpoint
CREATE TABLE `player_game_stats` (
	`player_id` text NOT NULL,
	`game_id` text NOT NULL,
	`team` text NOT NULL,
	`opponent` text NOT NULL,
	`passing_yards` real,
	`passing_attempts` real,
	`passing_touchdowns` real,
	`rushing_yards` real,
	`rushing_attempts` real,
	`rushing_touchdowns` real,
	`receiving_yards` real,
	`targets` real,
	`receptions` real,
	`receiving_touchdowns` real,
	`fantasy_points` real,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`player_id`, `game_id`),
	FOREIGN KEY (`player_id`) REFERENCES `nfl_players`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `nfl_games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `player_stats_game_idx` ON `player_game_stats` (`game_id`);--> statement-breakpoint
CREATE TABLE `prediction_results` (
	`prediction_id` text PRIMARY KEY NOT NULL,
	`outcome` integer NOT NULL,
	`settled_at` integer NOT NULL,
	`settlement_source` text NOT NULL,
	`brier_contribution` real NOT NULL,
	`log_loss_contribution` real NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`prediction_id`) REFERENCES `predictions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `prediction_results_settled_idx` ON `prediction_results` (`settled_at`);--> statement-breakpoint
CREATE TABLE `predictions` (
	`id` text PRIMARY KEY NOT NULL,
	`normalized_market_id` text NOT NULL,
	`listing_id` text NOT NULL,
	`model_version_id` text NOT NULL,
	`predicted_probability_bps` integer NOT NULL,
	`executable_price_bps` integer NOT NULL,
	`edge_bps` integer NOT NULL,
	`reliability_bps` integer NOT NULL,
	`opportunity_score` real NOT NULL,
	`sample_size` integer DEFAULT 0 NOT NULL,
	`features` text NOT NULL,
	`explanation` text NOT NULL,
	`predicted_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`normalized_market_id`) REFERENCES `normalized_markets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`listing_id`) REFERENCES `market_listings`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`model_version_id`) REFERENCES `model_versions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `predictions_market_time_idx` ON `predictions` (`normalized_market_id`,`predicted_at`);--> statement-breakpoint
CREATE INDEX `predictions_ranking_idx` ON `predictions` (`opportunity_score`,`predicted_at`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE INDEX `session_expiry_idx` ON `session` (`expires_at`);--> statement-breakpoint
CREATE TABLE `source_health` (
	`provider` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`last_success_at` integer,
	`last_failure_at` integer,
	`last_error` text,
	`latency_ms` integer,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `source_health_status_idx` ON `source_health` (`status`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `user_positions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`placed_at` integer NOT NULL,
	`platform` text NOT NULL,
	`type` text NOT NULL,
	`description` text NOT NULL,
	`stake_cents` integer NOT NULL,
	`entry_price_bps` integer,
	`status` text NOT NULL,
	`payout_cents` integer,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_positions_user_date_idx` ON `user_positions` (`user_id`,`placed_at`);--> statement-breakpoint
CREATE INDEX `user_positions_user_status_idx` ON `user_positions` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `user_positions_user_platform_idx` ON `user_positions` (`user_id`,`platform`);--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`theme` text DEFAULT 'system' NOT NULL,
	`default_platform` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE INDEX `verification_expiry_idx` ON `verification` (`expires_at`);--> statement-breakpoint
CREATE TABLE `weather_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`captured_at` integer NOT NULL,
	`forecast_for` integer NOT NULL,
	`temperature_f` real,
	`wind_mph` real,
	`precipitation_probability` real,
	`weather_code` integer,
	`severe` integer DEFAULT false NOT NULL,
	`source` text DEFAULT 'open-meteo' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `nfl_games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `weather_game_forecast_idx` ON `weather_snapshots` (`game_id`,`forecast_for`);