ALTER TABLE `source_projections` ADD `latest_projected_value` real;--> statement-breakpoint
ALTER TABLE `source_projections` ADD `latest_captured_at` integer;--> statement-breakpoint
ALTER TABLE `source_projections` ADD `observation_count` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
UPDATE `source_projections`
SET `latest_projected_value` = `projected_value`,
    `latest_captured_at` = `captured_at`
WHERE `latest_projected_value` IS NULL OR `latest_captured_at` IS NULL;
