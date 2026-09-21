import "server-only";

import { createHash } from "node:crypto";
import { and, desc, eq, isNull, lte, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  nflGames,
  nflPlayers,
  playerGameStats,
  sourceProjectionGrades,
  sourceProjections,
  sourceWeightHistory,
} from "@/db/schema";
import {
  ACTIVE_PROJECTION_SOURCES,
  calculateSourceWeights,
  normalizeLearningPlayer,
} from "./source-weighting";

const LEARNABLE_STATISTICS = new Set([
  "passing_yards",
  "passing_touchdowns",
  "passing_interceptions",
  "rushing_yards",
  "rushing_touchdowns",
  "receiving_yards",
  "receiving_touchdowns",
  "receptions",
  "touchdowns",
]);

type WeightValue = {
  effectiveWeek: number;
  weights: Record<string, number>;
} | null;

const weightCache = new Map<
  string,
  {
    at: number;
    value: WeightValue;
  }
>();
const weightInflight = new Map<string, Promise<WeightValue>>();

let schemaPromise: Promise<void> | null = null;

function errorChainText(error: unknown) {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      parts.push(current.message);
      current = (current as Error & { cause?: unknown }).cause;
      continue;
    }
    parts.push(String(current));
    break;
  }

  return parts.join(" ");
}

export function ensureSourceLearningSchema() {
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    const db = getDb();
    try {
      await db.run(
        sql.raw(
          "ALTER TABLE player_game_stats ADD COLUMN passing_interceptions real",
        ),
      );
    } catch (error) {
      // Drizzle wraps libSQL errors, so the useful SQLite message can live in
      // error.cause rather than the top-level Error.message.
      if (!/duplicate column name/i.test(errorChainText(error))) {
        throw error;
      }
    }

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS source_projections (
        id text PRIMARY KEY NOT NULL,
        season integer NOT NULL,
        week integer NOT NULL,
        player_name text NOT NULL,
        player_key text NOT NULL,
        statistic text NOT NULL,
        source text NOT NULL,
        projected_value real NOT NULL,
        captured_at integer NOT NULL,
        created_at integer DEFAULT (unixepoch()) NOT NULL,
        updated_at integer DEFAULT (unixepoch()) NOT NULL
      )
    `));
    await db.run(sql.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS source_projection_unique
      ON source_projections (season, week, player_key, statistic, source)
    `));
    await db.run(sql.raw(`
      CREATE INDEX IF NOT EXISTS source_projection_stat_week_idx
      ON source_projections (season, week, statistic)
    `));
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS source_projection_grades (
        projection_id text PRIMARY KEY NOT NULL,
        actual_value real NOT NULL,
        absolute_error real NOT NULL,
        squared_error real NOT NULL,
        graded_at integer NOT NULL,
        created_at integer DEFAULT (unixepoch()) NOT NULL,
        FOREIGN KEY (projection_id) REFERENCES source_projections(id)
          ON UPDATE no action ON DELETE cascade
      )
    `));
    await db.run(sql.raw(`
      CREATE INDEX IF NOT EXISTS source_projection_grades_time_idx
      ON source_projection_grades (graded_at)
    `));
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS source_weight_history (
        id text PRIMARY KEY NOT NULL,
        season integer NOT NULL,
        effective_week integer NOT NULL,
        statistic text NOT NULL,
        source text NOT NULL,
        weight real NOT NULL,
        sample_size integer NOT NULL,
        mae real,
        recent_mae real,
        created_at integer DEFAULT (unixepoch()) NOT NULL,
        updated_at integer DEFAULT (unixepoch()) NOT NULL
      )
    `));
    await db.run(sql.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS source_weight_unique
      ON source_weight_history (season, effective_week, statistic, source)
    `));
    await db.run(sql.raw(`
      CREATE INDEX IF NOT EXISTS source_weight_lookup_idx
      ON source_weight_history (season, statistic, effective_week)
    `));
  })().catch((error) => {
    schemaPromise = null;
    throw error;
  });

  return schemaPromise;
}

function stableId(prefix: string, value: string) {
  return `${prefix}_${createHash("sha256")
    .update(value)
    .digest("hex")
    .slice(0, 24)}`;
}

export async function getLearnedSourceWeights(
  statistic: string,
  season: number,
  week: number,
): Promise<WeightValue> {
  if (!LEARNABLE_STATISTICS.has(statistic)) return null;
  const cacheKey = `${season}:${week}:${statistic}`;
  const cached = weightCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 15 * 60_000) {
    return cached.value;
  }

  const pending = weightInflight.get(cacheKey);
  if (pending) return pending;

  const promise = (async (): Promise<WeightValue> => {
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
      const value = {
        effectiveWeek,
        weights: Object.fromEntries(
          selected.map((row) => [row.source, row.weight]),
        ),
      };
      weightCache.set(cacheKey, { at: Date.now(), value });
      return value;
    } catch {
      // Learning must never block the live feed. Equal weighting is the safe
      // fallback until persisted grades and weights are available.
      weightCache.set(cacheKey, { at: Date.now(), value: null });
      return null;
    }
  })();

  weightInflight.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    if (weightInflight.get(cacheKey) === promise) {
      weightInflight.delete(cacheKey);
    }
  }
}

function actualForStatistic(
  statistic: string,
  row: {
    passingYards: number | null;
    passingTouchdowns: number | null;
    passingInterceptions: number | null;
    rushingYards: number | null;
    rushingTouchdowns: number | null;
    receivingYards: number | null;
    receptions: number | null;
    receivingTouchdowns: number | null;
  },
) {
  if (statistic === "passing_yards") return row.passingYards;
  if (statistic === "passing_touchdowns") return row.passingTouchdowns;
  if (statistic === "passing_interceptions") return row.passingInterceptions;
  if (statistic === "rushing_yards") return row.rushingYards;
  if (statistic === "rushing_touchdowns") return row.rushingTouchdowns;
  if (statistic === "receiving_yards") return row.receivingYards;
  if (statistic === "receiving_touchdowns") return row.receivingTouchdowns;
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
        passingInterceptions: playerGameStats.passingInterceptions,
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

export interface SourceLearningActualRow {
  week: number;
  playerName: string;
  passingYards: number | null;
  passingTouchdowns: number | null;
  passingInterceptions: number | null;
  rushingYards: number | null;
  rushingTouchdowns: number | null;
  receivingYards: number | null;
  receptions: number | null;
  receivingTouchdowns: number | null;
}

async function gradeSourceProjectionsFromActualRows(
  season: number,
  actualRows: SourceLearningActualRow[],
) {
  if (!actualRows.length) return 0;
  const db = getDb();
  const ungraded = await db
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
    );

  const actualByKey = new Map<string, SourceLearningActualRow>();
  for (const row of actualRows) {
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
    const actualValue = actualForStatistic(projection.statistic, actualRow);
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

export async function runSourceLearningFromActuals(
  season: number,
  actualRows: SourceLearningActualRow[],
) {
  try {
    await ensureSourceLearningSchema();
    const graded = await gradeSourceProjectionsFromActualRows(
      season,
      actualRows,
    );
    const weights = await recomputeSourceWeights(season);
    return {
      graded,
      effectiveWeek: weights.effectiveWeek,
      weightsStored: weights.weightsStored,
    };
  } catch (error) {
    console.error("ESPN source grading failed", error);
    return {
      graded: 0,
      effectiveWeek: null,
      weightsStored: 0,
      error: error instanceof Error ? error.message : "Unknown learning error",
    };
  }
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
    await ensureSourceLearningSchema();
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
