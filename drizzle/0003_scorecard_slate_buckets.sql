ALTER TABLE `weekly_scorecard_picks` ADD `bucket` text;
--> statement-breakpoint
ALTER TABLE `weekly_scorecard_picks` ADD `bucket_rank` integer;
--> statement-breakpoint
DELETE FROM `weekly_scorecard_picks`
WHERE `season` = 2026
  AND `week` = 2
  AND `rank` <> 1;
--> statement-breakpoint
UPDATE `weekly_scorecard_picks`
SET `bucket` = 'mnf',
    `bucket_rank` = 1,
    `rank` = 1
WHERE `season` = 2026
  AND `week` = 2
  AND `rank` = 1;
--> statement-breakpoint
CREATE UNIQUE INDEX `weekly_scorecard_bucket_rank_unique`
ON `weekly_scorecard_picks` (`season`, `week`, `bucket`, `bucket_rank`);