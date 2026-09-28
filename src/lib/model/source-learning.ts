import "server-only";

import { and, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
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

type LegacySourceWeightRow = {
  statistic: string;
  source: string;
  weight: number;
  sampleSize: number;
  mae: number | null;
  recentMae: number | null;
};

// Exact Week 3 weight history recovered from the production audit that ran
// against the original Turso database on 2026-09-21 before the quota outage.
// These rows are original learned state, not postgame reconstruction.
const LEGACY_WEEK3_SOURCE_WEIGHTS: LegacySourceWeightRow[] = [
  { statistic: "passing_interceptions", source: "cbs", weight: 0.1672, sampleSize: 34, mae: 0.6323529411764706, recentMae: 0.6323529411764706 },
  { statistic: "passing_interceptions", source: "espn", weight: 0.1668, sampleSize: 28, mae: 0.6096824288214285, recentMae: 0.6096824288214285 },
  { statistic: "passing_interceptions", source: "fantasypros", weight: 0.1652, sampleSize: 10, mae: 0.74, recentMae: 0.74 },
  { statistic: "passing_interceptions", source: "numberfire", weight: 0.1652, sampleSize: 0, mae: null, recentMae: null },
  { statistic: "passing_interceptions", source: "rotoballer", weight: 0.1675, sampleSize: 30, mae: 0.6233333333333334, recentMae: 0.6233333333333334 },
  { statistic: "passing_interceptions", source: "sleeper", weight: 0.1680, sampleSize: 30, mae: 0.5963333333333332, recentMae: 0.5963333333333332 },

  { statistic: "passing_touchdowns", source: "cbs", weight: 0.1672, sampleSize: 36, mae: 0.8305555555555556, recentMae: 0.8305555555555556 },
  { statistic: "passing_touchdowns", source: "espn", weight: 0.1667, sampleSize: 28, mae: 0.9433765000000002, recentMae: 0.9433765000000002 },
  { statistic: "passing_touchdowns", source: "fantasypros", weight: 0.1666, sampleSize: 10, mae: 1, recentMae: 1 },
  { statistic: "passing_touchdowns", source: "numberfire", weight: 0.1666, sampleSize: 18, mae: 0.9905555555555554, recentMae: 0.9905555555555554 },
  { statistic: "passing_touchdowns", source: "rotoballer", weight: 0.1662, sampleSize: 30, mae: 0.98, recentMae: 0.98 },
  { statistic: "passing_touchdowns", source: "sleeper", weight: 0.1668, sampleSize: 30, mae: 0.979, recentMae: 0.979 },

  { statistic: "passing_yards", source: "cbs", weight: 0.1672, sampleSize: 36, mae: 52.04166666666666, recentMae: 52.04166666666666 },
  { statistic: "passing_yards", source: "espn", weight: 0.1672, sampleSize: 28, mae: 48.95316311428572, recentMae: 48.95316311428572 },
  { statistic: "passing_yards", source: "fantasypros", weight: 0.1665, sampleSize: 10, mae: 54.28000000000001, recentMae: 54.28000000000001 },
  { statistic: "passing_yards", source: "numberfire", weight: 0.1665, sampleSize: 18, mae: 58.96444444444445, recentMae: 58.96444444444445 },
  { statistic: "passing_yards", source: "rotoballer", weight: 0.1660, sampleSize: 30, mae: 55.28333333333334, recentMae: 55.28333333333334 },
  { statistic: "passing_yards", source: "sleeper", weight: 0.1665, sampleSize: 30, mae: 54.784666666666666, recentMae: 54.784666666666666 },

  { statistic: "receiving_touchdowns", source: "cbs", weight: 0.1721, sampleSize: 242, mae: 0.2681818181818186, recentMae: 0.1474999999999999 },
  { statistic: "receiving_touchdowns", source: "espn", weight: 0.1830, sampleSize: 247, mae: 0.2482771462672065, recentMae: 0.119538566025 },
  { statistic: "receiving_touchdowns", source: "fantasypros", weight: 0.1379, sampleSize: 28, mae: 0.5964285714285714, recentMae: 0.5964285714285714 },
  { statistic: "receiving_touchdowns", source: "numberfire", weight: 0.1410, sampleSize: 0, mae: null, recentMae: null },
  { statistic: "receiving_touchdowns", source: "rotoballer", weight: 0.1830, sampleSize: 228, mae: 0.2649122807017548, recentMae: 0.20999999999999988 },
  { statistic: "receiving_touchdowns", source: "sleeper", weight: 0.1830, sampleSize: 284, mae: 0.23683098591549295, recentMae: 0.14549999999999996 },

  { statistic: "receiving_yards", source: "cbs", weight: 0.1746, sampleSize: 242, mae: 16.855371900826444, recentMae: 12.185 },
  { statistic: "receiving_yards", source: "espn", weight: 0.1694, sampleSize: 247, mae: 17.333761914133603, recentMae: 14.854364992549996 },
  { statistic: "receiving_yards", source: "fantasypros", weight: 0.1498, sampleSize: 28, mae: 28.710714285714285, recentMae: 28.710714285714285 },
  { statistic: "receiving_yards", source: "numberfire", weight: 0.1486, sampleSize: 33, mae: 28.277878787878787, recentMae: 28.277878787878787 },
  { statistic: "receiving_yards", source: "rotoballer", weight: 0.1608, sampleSize: 228, mae: 18.078070175438587, recentMae: 17.67 },
  { statistic: "receiving_yards", source: "sleeper", weight: 0.1967, sampleSize: 284, mae: 14.89820422535212, recentMae: 13.960499999999993 },

  { statistic: "receptions", source: "cbs", weight: 0.1730, sampleSize: 242, mae: 1.2764462809917363, recentMae: 1.085 },
  { statistic: "receptions", source: "espn", weight: 0.1737, sampleSize: 247, mae: 1.2926920162833997, recentMae: 1.1799911855749996 },
  { statistic: "receptions", source: "fantasypros", weight: 0.1557, sampleSize: 28, mae: 1.9107142857142856, recentMae: 1.9107142857142856 },
  { statistic: "receptions", source: "numberfire", weight: 0.1544, sampleSize: 33, mae: 1.9712121212121216, recentMae: 1.9712121212121216 },
  { statistic: "receptions", source: "rotoballer", weight: 0.1588, sampleSize: 228, mae: 1.322807017543859, recentMae: 1.3050000000000002 },
  { statistic: "receptions", source: "sleeper", weight: 0.1844, sampleSize: 284, mae: 1.1391901408450702, recentMae: 1.19975 },

  { statistic: "rushing_touchdowns", source: "cbs", weight: 0.1810, sampleSize: 209, mae: 0.15645933014354074, recentMae: 0.07500000000000002 },
  { statistic: "rushing_touchdowns", source: "espn", weight: 0.1810, sampleSize: 156, mae: 0.22387201169871784, recentMae: 0.08042228592500003 },
  { statistic: "rushing_touchdowns", source: "fantasypros", weight: 0.1461, sampleSize: 28, mae: 0.3928571428571429, recentMae: 0.3928571428571429 },
  { statistic: "rushing_touchdowns", source: "numberfire", weight: 0.1470, sampleSize: 0, mae: null, recentMae: null },
  { statistic: "rushing_touchdowns", source: "rotoballer", weight: 0.1639, sampleSize: 118, mae: 0.288135593220339, recentMae: 0.2399999999999999 },
  { statistic: "rushing_touchdowns", source: "sleeper", weight: 0.1810, sampleSize: 224, mae: 0.1617410714285714, recentMae: 0.07299999999999994 },

  { statistic: "rushing_yards", source: "cbs", weight: 0.2024, sampleSize: 207, mae: 9.645410628019327, recentMae: 4.4325 },
  { statistic: "rushing_yards", source: "espn", weight: 0.1598, sampleSize: 156, mae: 12.550317809846153, recentMae: 3.986641728375001 },
  { statistic: "rushing_yards", source: "fantasypros", weight: 0.1399, sampleSize: 36, mae: 16.825000000000003, recentMae: 16.825000000000003 },
  { statistic: "rushing_yards", source: "numberfire", weight: 0.1435, sampleSize: 0, mae: null, recentMae: null },
  { statistic: "rushing_yards", source: "rotoballer", weight: 0.1319, sampleSize: 119, mae: 15.02521008403361, recentMae: 8.967499999999998 },
  { statistic: "rushing_yards", source: "sleeper", weight: 0.2224, sampleSize: 224, mae: 9.20625, recentMae: 3.776499999999998 },

  { statistic: "touchdowns", source: "cbs", weight: 0.1567, sampleSize: 187, mae: 0.3962566844919787, recentMae: 0.39 },
  { statistic: "touchdowns", source: "espn", weight: 0.1852, sampleSize: 206, mae: 0.35109375659223285, recentMae: 0.29746306147499996 },
  { statistic: "touchdowns", source: "fantasypros", weight: 0.1483, sampleSize: 32, mae: 0.6437499999999999, recentMae: 0.6437499999999999 },
  { statistic: "touchdowns", source: "numberfire", weight: 0.1411, sampleSize: 52, mae: 0.631730769230769, recentMae: 0.6779999999999998 },
  { statistic: "touchdowns", source: "rotoballer", weight: 0.1828, sampleSize: 192, mae: 0.36666666666666686, recentMae: 0.3399999999999999 },
  { statistic: "touchdowns", source: "sleeper", weight: 0.1859, sampleSize: 220, mae: 0.3450454545454544, recentMae: 0.29324999999999996 },
];

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
        latest_projected_value real,
        latest_captured_at integer,
        observation_count integer DEFAULT 1 NOT NULL,
        created_at integer DEFAULT (unixepoch()) NOT NULL,
        updated_at integer DEFAULT (unixepoch()) NOT NULL
      )
    `));
    const addProjectionColumn = async (statement: string) => {
      try {
        await db.run(sql.raw(statement));
      } catch (error) {
        if (!/duplicate column name/i.test(errorChainText(error))) throw error;
      }
    };
    await addProjectionColumn(
      "ALTER TABLE source_projections ADD COLUMN latest_projected_value real",
    );
    await addProjectionColumn(
      "ALTER TABLE source_projections ADD COLUMN latest_captured_at integer",
    );
    await addProjectionColumn(
      "ALTER TABLE source_projections ADD COLUMN observation_count integer DEFAULT 1 NOT NULL",
    );
    // Do not run data backfills from application startup. The previous
    // startup UPDATE scanned/touched the whole projection table on every cold
    // process and could consume a large share of the hosted database quota.
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

async function stableId(prefix: string, value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${prefix}_${hex.slice(0, 24)}`;
}

export async function restoreLegacySourceWeightHistory() {
  await ensureSourceLearningSchema();
  const db = getDb();
  const values = await Promise.all(
    LEGACY_WEEK3_SOURCE_WEIGHTS.map(async (row) => ({
      id: await stableId(
        "source_weight",
        `2026:3:${row.statistic}:${row.source}`,
      ),
      season: 2026,
      effectiveWeek: 3,
      statistic: row.statistic,
      source: row.source,
      weight: row.weight,
      sampleSize: row.sampleSize,
      mae: row.mae,
      recentMae: row.recentMae,
    })),
  );

  let inserted = 0;
  for (let index = 0; index < values.length; index += 100) {
    const chunk = values.slice(index, index + 100);
    if (!chunk.length) continue;
    await db
      .insert(sourceWeightHistory)
      .values(chunk)
      .onConflictDoNothing({
        target: sourceWeightHistory.id,
      });
    inserted += chunk.length;
  }
  weightCache.clear();
  return { attempted: values.length, inserted };
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

  const actualRows = await db
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
    );

  const finalWeeks = [
    ...new Set(
      actualRows
        .map((row) => row.week)
        .filter((week): week is number => week !== null),
    ),
  ];
  if (!finalWeeks.length) return 0;

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
        inArray(sourceProjections.week, finalWeeks),
        isNull(sourceProjectionGrades.projectionId),
      ),
    );

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
        inArray(
          sourceProjections.week,
          [...new Set(actualRows.map((row) => row.week))],
        ),
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
    if (!graded) {
      return {
        graded: 0,
        effectiveWeek: null,
        weightsStored: 0,
      };
    }
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
    .where(
      and(
        eq(sourceProjections.season, season),
        eq(sourceProjections.learningEligible, true),
      ),
    )
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
      const id = await stableId(
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
    if (!graded) {
      return {
        graded: 0,
        effectiveWeek: null,
        weightsStored: 0,
      };
    }
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
