CREATE INDEX IF NOT EXISTS `predictions_time_idx` ON `predictions` (`predicted_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `predictions_listing_time_idx` ON `predictions` (`listing_id`,`predicted_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `price_snapshot_time_idx` ON `market_price_snapshots` (`captured_at`);
