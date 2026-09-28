import "dotenv/config";

import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../src/db";
import {
  nflGames,
  nflPlayers,
  playerGameStats,
  sourceProjections,
} from "../src/db/schema";
import { ingestNflverseSeason } from "../src/lib/nfl/nflverse";
import { getWeeklyProjectionStatSnapshots } from "../src/lib/model/external-projections";
import { normalizeLearningPlayer } from "../src/lib/model/source-weighting";

function stableId(prefix: string, value: string) {
  const hex = createHash("sha256").update(value).digest("hex");
  return `${prefix}_${hex.slice(0, 24)}`;
}

async function main() {
  const season = Number(process.argv[2] ?? "2026");
  const week = Number(process.argv[3] ?? "3");
  if (!Number.isInteger(season) || !Number.isInteger(week)) {
    throw new Error("Usage: npm run recovery:week -- <season> <week>");
  }

  const ingestion = await ingestNflverseSeason(season);
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
    console.log(JSON.stringify({ season, week, ingestion, completedGames: 0 }));
    return;
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

  console.log(
    JSON.stringify(
      {
        season,
        week,
        ingestion,
        completedGames: completedGames.length,
        completedPlayers: playerNameByKey.size,
        sourceRowsFound: snapshots.length,
        recoveredRowsEligibleForDisplay: recovered.length,
        inserted,
        bySource,
        note:
          "Recovered rows are tagged recovered_post_outage and learningEligible=false, so they cannot influence source weights.",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
