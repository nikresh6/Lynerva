import "server-only";

import { createHash } from "node:crypto";
import { access, writeFile } from "node:fs/promises";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import {
  nflGames,
  nflPlayers,
  playerGameStats,
  sourceProjections,
} from "@/db/schema";
import { ingestNflverseSeason } from "@/lib/nfl/nflverse";
import { getWeeklyProjectionStatSnapshots } from "@/lib/model/external-projections";
import { normalizeLearningPlayer } from "@/lib/model/source-weighting";

function stableId(prefix: string, value: string) {
  const hex = createHash("sha256").update(value).digest("hex");
  return `${prefix}_${hex.slice(0, 24)}`;
}

function markerPath(season: number, week: number) {
  return `/data/.huddlemark-recovery-${season}-${week}.done`;
}

export async function hasWeekRecoveryMarker(season: number, week: number) {
  try {
    await access(markerPath(season, week));
    return true;
  } catch {
    return false;
  }
}

async function recoverWeekAfterIngestion(
  season: number,
  week: number,
  ingestion: Awaited<ReturnType<typeof ingestNflverseSeason>>,
) {
  const db = getDb();

  const completedGames = await db
    .select({
      id: nflGames.id,
      homeTeam: nflGames.homeTeam,
      awayTeam: nflGames.awayTeam,
      status: nflGames.status,
      kickoffAt: nflGames.kickoffAt,
    })
    .from(nflGames)
    .where(
      and(
        eq(nflGames.season, season),
        eq(nflGames.week, week),
        eq(nflGames.seasonType, "REG"),
        eq(nflGames.status, "final"),
      ),
    );

  const completedGameIds = completedGames.map((game) => game.id);
  if (!completedGameIds.length) {
    return {
      season,
      week,
      ingestion,
      completedGames: 0,
      completedPlayers: 0,
      sourceRowsFound: 0,
      recoveredRowsEligibleForDisplay: 0,
      inserted: 0,
      bySource: {} as Record<string, number>,
    };
  }

  const completedPlayers = await db
    .select({
      fullName: nflPlayers.fullName,
      gameId: playerGameStats.gameId,
    })
    .from(playerGameStats)
    .innerJoin(nflPlayers, eq(nflPlayers.id, playerGameStats.playerId))
    .where(inArray(playerGameStats.gameId, completedGameIds));

  const playerNameByKey = new Map<string, string>();
  for (const row of completedPlayers) {
    const key = normalizeLearningPlayer(row.fullName);
    if (key) playerNameByKey.set(key, row.fullName);
  }

  const snapshots = await getWeeklyProjectionStatSnapshots(season, week);
  const now = new Date();
  const recovered = snapshots.flatMap((point) => {
    const playerName = playerNameByKey.get(point.playerKey);
    if (!playerName) return [];
    const id = stableId(
      "source_projection",
      `${season}:${week}:${point.playerKey}:${point.statistic}:${point.source}`,
    );
    return [{
      id,
      season,
      week,
      playerName,
      playerKey: point.playerKey,
      statistic: point.statistic,
      source: point.source,
      projectedValue: point.value,
      capturedAt: now,
      latestProjectedValue: point.value,
      latestCapturedAt: now,
      observationCount: 1,
      provenance: "recovered_post_outage",
      learningEligible: false,
    }];
  });

  let inserted = 0;
  const bySource: Record<string, number> = {};
  for (let index = 0; index < recovered.length; index += 100) {
    const chunk = recovered.slice(index, index + 100);
    if (!chunk.length) continue;
    const before = await db
      .select({ id: sourceProjections.id })
      .from(sourceProjections)
      .where(inArray(sourceProjections.id, chunk.map((row) => row.id)));
    const existing = new Set(before.map((row) => row.id));
    const newRows = chunk.filter((row) => !existing.has(row.id));
    if (!newRows.length) continue;
    await db
      .insert(sourceProjections)
      .values(newRows)
      .onConflictDoNothing({ target: sourceProjections.id });
    inserted += newRows.length;
    for (const row of newRows) {
      bySource[row.source] = (bySource[row.source] ?? 0) + 1;
    }
  }

  const result = {
    season,
    week,
    ingestion,
    completedGames: completedGames.length,
    completedPlayers: playerNameByKey.size,
    sourceRowsFound: snapshots.length,
    recoveredRowsEligibleForDisplay: recovered.length,
    inserted,
    bySource,
  };

  await writeFile(markerPath(season, week), JSON.stringify(result, null, 2));
  return result;
}

export async function recoverOutageWeek(season: number, week: number) {
  const ingestion = await ingestNflverseSeason(season);
  return recoverWeekAfterIngestion(season, week, ingestion);
}

export async function recoverHistoricalSourceWeeks(
  season: number,
  weeks: readonly number[],
) {
  const missingWeeks: number[] = [];
  for (const week of weeks) {
    if (!(await hasWeekRecoveryMarker(season, week))) missingWeeks.push(week);
  }
  if (!missingWeeks.length) {
    return {
      season,
      skipped: true,
      weeks: [] as Array<Awaited<ReturnType<typeof recoverWeekAfterIngestion>>>,
    };
  }

  // One nflverse refresh is enough for every historical week. The old recovery
  // path re-ingested the whole season once per week, which was wasteful on the
  // small Railway container.
  const ingestion = await ingestNflverseSeason(season);
  const results = [];
  for (const week of missingWeeks) {
    results.push(await recoverWeekAfterIngestion(season, week, ingestion));
  }
  return { season, skipped: false, weeks: results };
}
