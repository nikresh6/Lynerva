import "server-only";

import { createHash } from "node:crypto";
import { and, desc, eq, isNull, lte } from "drizzle-orm";
import { getDb } from "@/db";
import {
  nflGames,
  nflPlayers,
  playerGameStats,
  sourceProjectionGrades,
  sourceProjections,
  sourceWeightHistory,
} from "@/db/schema";
import { clamp } from "@/lib/utils";

export const ACTIVE_PROJECTION_SOURCES = [
  "fantasypros",
  "numberfire",
  "espn",
  "cbs",
  "covers",
  "dimers",
] as const;

export type ActiveProjectionSource =
  (typeof ACTIVE_PROJECTION_SOURCES)[number];

const LEARNABLE_STATISTICS = new Set([
  "passing_yards",
  "passing_touchdowns",
  "rushing_yards",
  "receiving_yards",
  "receptions",
  "touchdowns",
]);

export interface SourceGradeSample {
  source: string;
  absoluteError: number;
  gradedAt: Date;
}

export interface LearnedSourceWeight {
  source: string;
  weight: number;
  sampleSize: number;
  mae: number | null;
  recentMae: number | null;
}

const weightCache = new Map<
  string,
  {
    at: number;
    value: {
      effectiveWeek: number;
      weights: Record<string, number>;
    } | null;
  }
>();

function stableId(prefix: string, value: string) {
  return `${prefix}_${createHash("sha256")
    .update(value)
    .digest("hex")
    .slice(0, 24)}`;
}

export function normalizeLearningPlayer(value: string) {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function mean(values: number[]) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function calculateSourceWeights(
  samples: SourceGradeSample[],
  sources: readonly string[] = ACTIVE_PROJECTION_SOURCES,
): LearnedSourceWeight[] {
  const prior = 1 / Math.max(sources.length, 1);
  const bySource = new Map<string, SourceGradeSample[]>();

  for (const source of sources) bySource.set(source, []);
  for (const sample of samples) {
    if (!bySource.has(sample.source)) continue;
    bySource.get(sample.source)!.push(sample);
  }

  const metrics = sources.map((source) => {
    const rows = (bySource.get(source) ?? []).toSorted(
      (first, second) => second.gradedAt.getTime() - first.gradedAt.getTime(),
    );
    const allErrors = rows.map((row) => row.absoluteError);
    const recentErrors = rows.slice(0, 40).map((row) => row.absoluteError);
    const mae = mean(allErrors);
    const recentMae = mean(recentErrors);
    const blendedError =
      mae === null
        ? null
        : 0.65 * mae + 0.35 * (recentMae ?? mae);
    return {
      source,
      sampleSize: rows.length,
      mae,
      recentMae,
      performance:
        blendedError === null ? null : 1 / Math.max(blendedError, 0.25),
    };
  });

  const performanceTotal = metrics.reduce(
    (sum, metric) => sum + (metric.performance ?? 0),
    0,
  );

  const raw = metrics.map((metric) => {
    const learnedTarget =
      metric.performance !== null && performanceTotal > 0
        ? metric.performance / performanceTotal
        : prior;
    // Do not let a tiny sample swing the ensemble. Learning starts after
    // 20 graded player-stat observations and tops out at 75% learned weight.
    const confidence = clamp((metric.sampleSize - 20) / 180, 0, 0.75);
    return {
      ...metric,
      rawWeight:
        prior * (1 - confidence) + learnedTarget * confidence,
    };
  });

  const total = raw.reduce((sum, metric) => sum + metric.rawWeight, 0) || 1;
  return raw.map((metric) => ({
    source: metric.source,
    weight: metric.rawWeight / total,
    sampleSize: metric.sampleSize,
    mae: metric.mae,
    recentMae: metric.recentMae,
  }));
}

export async function getLearnedSourceWeights(
  statistic: string,
  season: number,
  week: number,
) {
  if (!LEARNABLE_STATISTICS.has(statistic)) return null;
  const cacheKey = `${season}:${week}:${statistic}`;
  const cached = weightCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 15 * 60_000) {
    return cached.value;
  }

  try {
    const db = getDb();
    const rows = await db
      .select({
        source: sourceWeightHistory.source,
        weight: sourceWeightHistory.weight,
        effectiveWeek: sourceWeightHistory.effectiveWeek,
      })
      .from(sourceWeightHistory)
      .where(
        and(
          eq(sourceWeightHistory.season, season),
          eq(sourceWeightHistory.statistic, statistic),
          lte(sourceWeightHistory.effectiveWeek, week),
        ),
      )
      .orderBy(desc(sourceWeightHistory.effectiveWeek))
      .limit(ACTIVE_PROJECTION_SOURCES.length * 4);

    const effectiveWeek = rows[0]?.effectiveWeek;
    if (effectiveWeek === undefined) {
      weightCache.set(cacheKey, { at: Date.now(), value: null });
      return null;
    }

    const selected = rows.filter(
      (row) => row.effectiveWeek === effectiveWeek,
    );
    const weights = Object.fromEntries(
      selected.map((row) => [row.source, row.weight]),
    );
    const value = { effectiveWeek, weights };
    weightCache.set(cacheKey, { at: Date.now(), value });
    return value;
  } catch {
    // Database learning is optional for serving the live feed. Equal weighting
    // remains the safe fallback until the learning tables/data are available.
    weightCache.set(cacheKey, { at: Date.now(), value: null });
    return null;
  }
}

function actualForStatistic(
  statistic: string,
  row: {
    passingYards: number | null;
    passingTouchdowns: number | null;
    rushingYards: number | null;
    rushingTouchdowns: number | null;
    receivingYards: number | null;
    receptions: number | null;
    receivingTouchdowns: number | null;
  },
) {
  if (statistic === "passing_yards") return row.passingYards;
  if (statistic === "passing_touchdowns") return row.passingTouchdowns;
  if (statistic === "rushing_yards") return row.rushingYards;
  if (statistic === "receiving_yards") return row.receivingYards;
  if (statistic === "receptions") return row.receptions;
  if (statistic === "touchdowns") {
    if (
      row.rushingTouchdowns === null &&
      row.receivingTouchdowns === null
    ) {
      return null;
    }
    return (row.rushingTouchdowns ?? 0) + (row.receivingTouchdowns ?? 0);
  }
  return null;
}

async function gradeNewSourceProjections(season: number) {
  const db = getDb();

  const [ungraded, actualRows] = await Promise.all([
    db
      .select({
        id: sourceProjections.id,
        week: sourceProjections.week,
        playerKey: sourceProjections.playerKey,
        statistic: sourceProjections.statistic,
        projectedValue: sourceProjections.projectedValue,
      })
      .from(sourceProjections)
      .leftJoin(
        sourceProjectionGrades,
        eq(sourceProjectionGrades.projectionId, sourceProjections.id),
      )
      .where(
        and(
          eq(sourceProjections.season, season),
          isNull(sourceProjectionGrades.projectionId),
        ),
      ),
    db
      .select({
        playerName: nflPlayers.fullName,
        week: nflGames.week,
        passingYards: playerGameStats.passingYards,
        passingTouchdowns: playerGameStats.passingTouchdowns,
        rushingYards: playerGameStats.rushingYards,
        rushingTouchdowns: playerGameStats.rushingTouchdowns,
        receivingYards: playerGameStats.receivingYards,
        receptions: playerGameStats.receptions,
        receivingTouchdowns: playerGameStats.receivingTouchdowns,
      })
      .from(playerGameStats)
      .innerJoin(nflPlayers, eq(nflPlayers.id, playerGameStats.playerId))
      .innerJoin(nflGames, eq(nflGames.id, playerGameStats.gameId))
      .where(
        and(
          eq(nflGames.season, season),
          eq(nflGames.seasonType, "REG"),
          eq(nflGames.status, "final"),
        ),
      ),
  ]);

  const actualByKey = new Map<string, typeof actualRows[number]>();
  for (const row of actualRows) {
    if (row.week === null) continue;
    actualByKey.set(
      `${row.week}:${normalizeLearningPlayer(row.playerName)}`,
      row,
    );
  }

  const grades = [];
  for (const projection of ungraded) {
    if (!LEARNABLE_STATISTICS.has(projection.statistic)) continue;
    const actualRow = actualByKey.get(
      `${projection.week}:${projection.playerKey}`,
    );
    if (!actualRow) continue;
    const actualValue = actualForStatistic(
      projection.statistic,
      actualRow,
    );
    if (actualValue === null) continue;
    const error = projection.projectedValue - actualValue;
    grades.push({
      projectionId: projection.id,
      actualValue,
      absoluteError: Math.abs(error),
      squaredError: error ** 2,
      gradedAt: new Date(),
    });
  }

  for (let index = 0; index < grades.length; index += 100) {
    const chunk = grades.slice(index, index + 100);
    if (!chunk.length) continue;
    await db
      .insert(sourceProjectionGrades)
      .values(chunk)
      .onConflictDoNothing({
        target: sourceProjectionGrades.projectionId,
      });
  }

  return grades.length;
}

async function recomputeSourceWeights(season: number) {
  const db = getDb();
  const rows = await db
    .select({
      source: sourceProjections.source,
      statistic: sourceProjections.statistic,
      week: sourceProjections.week,
      absoluteError: sourceProjectionGrades.absoluteError,
      gradedAt: sourceProjectionGrades.gradedAt,
    })
    .from(sourceProjectionGrades)
    .innerJoin(
      sourceProjections,
      eq(sourceProjections.id, sourceProjectionGrades.projectionId),
    )
    .where(eq(sourceProjections.season, season))
    .orderBy(desc(sourceProjectionGrades.gradedAt));

  if (!rows.length) {
    return { effectiveWeek: null as number | null, weightsStored: 0 };
  }

  const latestGradedWeek = Math.max(...rows.map((row) => row.week));
  const effectiveWeek = latestGradedWeek + 1;
  const statistics = [...new Set(rows.map((row) => row.statistic))];
  let weightsStored = 0;

  for (const statistic of statistics) {
    const samples = rows
      .filter((row) => row.statistic === statistic)
      .map((row) => ({
        source: row.source,
        absoluteError: row.absoluteError,
        gradedAt: row.gradedAt,
      }));
    const weights = calculateSourceWeights(samples);

    for (const weight of weights) {
      const id = stableId(
        "source_weight",
        `${season}:${effectiveWeek}:${statistic}:${weight.source}`,
      );
      await db
        .insert(sourceWeightHistory)
        .values({
          id,
          season,
          effectiveWeek,
          statistic,
          source: weight.source,
          weight: weight.weight,
          sampleSize: weight.sampleSize,
          mae: weight.mae,
          recentMae: weight.recentMae,
        })
        .onConflictDoUpdate({
          target: sourceWeightHistory.id,
          set: {
            weight: weight.weight,
            sampleSize: weight.sampleSize,
            mae: weight.mae,
            recentMae: weight.recentMae,
            updatedAt: new Date(),
          },
        });
      weightsStored += 1;
    }
  }

  weightCache.clear();
  return { effectiveWeek, weightsStored };
}

export async function runSourceLearningLoop(season: number) {
  try {
    const graded = await gradeNewSourceProjections(season);
    const weights = await recomputeSourceWeights(season);
    return {
      graded,
      effectiveWeek: weights.effectiveWeek,
      weightsStored: weights.weightsStored,
    };
  } catch (error) {
    console.error("Source learning loop failed", error);
    return {
      graded: 0,
      effectiveWeek: null,
      weightsStored: 0,
      error: error instanceof Error ? error.message : "Unknown learning error",
    };
  }
}
