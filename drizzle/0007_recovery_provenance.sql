ALTER TABLE `source_projections` ADD `provenance` text DEFAULT 'live_capture' NOT NULL;
--> statement-breakpoint
ALTER TABLE `source_projections` ADD `learning_eligible` integer DEFAULT true NOT NULL;
