import "server-only";

import { and, count, desc, eq, gte, max } from "drizzle-orm";
import { getDb } from "@/db";
import { clamp } from "@/lib/utils";
import {
  nflGames,
  moneylineSourceWeightHistory,
  normalizedMarkets,
  predictions,
  sourceProjectionGrades,
  sourceProjections,
  sourceWeightHistory,
} from "@/db/schema";
import { ACTIVE_PROJECTION_SOURCES } from "./source-weighting";
import {
  MONEYLINE_WEIGHT_PRIORS,
  type MoneylineSource,
} from "./moneyline-weighting";

export const MONEYLINE_SOURCE_INFO = {
  nflverse_current_season_scoring: {
    name: "nflverse Scoring",
    kind: "Moneyline-only current-season model input",
    href: "https://github.com/nflverse/nfldata",
    access: "Free nflverse regular-season data",
    note: "Huddlemark turns current-season points for and points against into a game win probability. This input is used only for moneylines.",
  },
  nflverse_current_season_record: {
    name: "nflverse Record",
    kind: "Moneyline-only current-season model input",
    href: "https://github.com/nflverse/nfldata",
    access: "Free nflverse regular-season data",
    note: "A separate current-season record component that converts wins, losses, ties, and home field into a moneyline probability.",
  },
  espn_fpi: {
    name: "ESPN FPI",
    kind: "Moneyline-only pregame probability",
    href: "https://www.espn.com/nfl/fpi",
    access: "Public ESPN game predictor",
    note: "Pregame team win probability from ESPN's public game summary. Live win probability is intentionally excluded from the pregame source leaderboard.",
  },
} as const;

const MONEYLINE_SOURCE_IDS = Object.keys(
  MONEYLINE_SOURCE_INFO,
) as Array<keyof typeof MONEYLINE_SOURCE_INFO>;

export const PROJECTION_SOURCE_INFO = {
  fantasypros: {
    name: "FantasyPros",
    kind: "Public weekly projection site",
    href: "https://www.fantasypros.com/nfl/projections/",
    logo: "https://www.fantasypros.com/favicon.ico",
    access: "Free public weekly tables",
    note: "Weekly player stat projections. Huddlemark rejects the page unless it explicitly matches the requested NFL week.",
  },
  numberfire: {
    name: "numberFire",
    kind: "Public weekly projection site",
    href: "https://www.numberfire.com/nfl/fantasy/fantasy-football-projections",
    logo: "https://www.numberfire.com/favicon.ico",
    access: "Free public weekly tables",
    note: "Weekly player projections from the public numberFire widgets. Wrong-week responses are discarded.",
  },
  espn: {
    name: "ESPN",
    kind: "Public fantasy projection feed",
    href: "https://fantasy.espn.com/football/",
    logo: "https://a.espncdn.com/i/espn/misc_logos/500/espn.png",
    access: "No paid key or account used",
    note: "Huddlemark accepts only the exact requested scoring period from ESPN's public fantasy feed.",
  },
  cbs: {
    name: "CBS Sports",
    kind: "Public weekly projection site",
    href: "https://www.cbssports.com/fantasy/football/stats/",
    logo: "https://sports.cbsimg.net/favicon.ico",
    access: "Free public weekly tables",
    note: "Position-specific weekly stat projections. Rest-of-season and season views are rejected.",
  },
  rotoballer: {
    name: "RotoBaller",
    kind: "Public weekly projection site",
    href: "https://www.rotoballer.com/category/nfl/fantasy-football-advice-analysis/fantasy-football-projections-articles-analysis",
    logo: "https://www.rotoballer.com/favicon.ico",
    access: "Free public weekly article",
    note: "Weekly stat-line projection table parsed only when the article title and season match the requested week.",
  },
  sleeper: {
    name: "Sleeper",
    kind: "Public projection API",
    href: "https://sleeper.com/",
    logo: "https://sleeper.com/favicon.ico",
    access: "No paid key or account used",
    note: "Weekly stat lines from Sleeper's public projection endpoint. Huddlemark ignores bye/filler rows and requires a real game plus a published projection.",
  },
  covers: {
    name: "Covers",
    kind: "Public player-prop projection model",
    href: "https://www.covers.com/sport/football/nfl/player-props",
    logo: "https://www.covers.com/favicon.ico",
    access: "Free public player-prop projections",
    note: "Current player-prop projections from Covers. Only a player and stat actually published on the public page count as a source point.",
  },
  dimers: {
    name: "Dimers",
    kind: "Public weekly projection site",
    href: "https://www.dimers.com/nfl/player-projections",
    logo: "https://www.dimers.com/favicon.ico",
    access: "Free public rows only",
    note: "Weekly projections from the rows Dimers exposes publicly. Locked Pro rows are never scraped or treated as available data.",
  },
} as const;

export type MoneylinePerformanceRow = {
  source: string;
  sampleSize: number;
  brierScore: number;
  accuracy: number;
  logLoss: number;
  weight: number | null;
  priorWeight: number;
  effectiveWeek: number | null;
  previousWeight: number | null;
  previousEffectiveWeek: number | null;
  examples: Array<{
    week: number;
    matchup: string;
    subject: string;
    probabilityBps: number;
    outcome: 0 | 0.5 | 1;
  }>;
};

type LegacyPerformanceMetric = {
  medianAbsoluteError: number;
  p90AbsoluteError: number;
  recentMedianAbsoluteError: number;
  robustError: number;
  bias: number;
};

// Exact source-performance metrics printed by the pre-outage production audit
// on 2026-09-21. Keep these as the authoritative historical Week 1-2 learning
// state until enough new, genuinely pregame local-SQLite samples replace them.
const LEGACY_WEEK3_PERFORMANCE = new Map<string, LegacyPerformanceMetric>(
  [
    ["passing_interceptions:fantasypros", 0.60, 1.42, 0.60, 0.764, -0.100],
    ["passing_interceptions:espn", 0.66, 0.80, 0.66, 0.687, 0.186],
    ["passing_interceptions:cbs", 0.60, 1.21, 0.60, 0.722, 0.162],
    ["passing_interceptions:rotoballer", 0.60, 0.93, 0.60, 0.666, 0.137],
    ["passing_interceptions:sleeper", 0.54, 1.06, 0.54, 0.641, 0.120],

    ["passing_touchdowns:fantasypros", 0.95, 1.72, 0.95, 1.104, 0.020],
    ["passing_touchdowns:numberfire", 0.91, 1.71, 0.91, 1.065, 0.299],
    ["passing_touchdowns:espn", 0.85, 1.79, 0.85, 1.037, -0.083],
    ["passing_touchdowns:cbs", 0.85, 1.70, 0.85, 1.020, 0.131],
    ["passing_touchdowns:rotoballer", 0.95, 1.72, 0.95, 1.104, 0.017],
    ["passing_touchdowns:sleeper", 0.82, 1.93, 0.82, 1.038, 0.036],

    ["passing_yards:fantasypros", 37.80, 134.05, 37.80, 57.050, 4.020],
    ["passing_yards:numberfire", 49.21, 106.67, 49.21, 60.702, 19.059],
    ["passing_yards:espn", 36.30, 110.05, 36.30, 51.051, 9.202],
    ["passing_yards:cbs", 38.50, 113.50, 38.50, 53.500, -9.947],
    ["passing_yards:rotoballer", 41.55, 128.38, 41.55, 58.916, 16.667],
    ["passing_yards:sleeper", 40.98, 115.93, 40.98, 55.975, 2.562],

    ["receiving_touchdowns:fantasypros", 0.50, 1.40, 0.50, 0.680, -0.311],
    ["receiving_touchdowns:espn", 0.14, 0.64, 0.71, 0.409, 0.006],
    ["receiving_touchdowns:cbs", 0.20, 0.70, 0.70, 0.450, 0.041],
    ["receiving_touchdowns:rotoballer", 0.15, 0.60, 0.70, 0.405, 0.014],
    ["receiving_touchdowns:sleeper", 0.12, 0.62, 0.78, 0.417, 0.006],

    ["receiving_yards:fantasypros", 28.00, 54.05, 28.00, 33.210, -7.221],
    ["receiving_yards:numberfire", 24.23, 54.19, 24.23, 30.222, -1.029],
    ["receiving_yards:espn", 11.94, 39.79, 43.49, 26.976, 0.596],
    ["receiving_yards:cbs", 12.30, 38.47, 43.45, 26.879, 1.298],
    ["receiving_yards:rotoballer", 13.05, 40.22, 42.00, 27.169, 1.104],
    ["receiving_yards:sleeper", 8.92, 37.73, 43.30, 24.997, -0.740],

    ["receptions:fantasypros", 1.60, 3.16, 1.60, 1.912, -0.575],
    ["receptions:numberfire", 1.58, 3.42, 1.58, 1.948, 0.012],
    ["receptions:espn", 0.94, 2.85, 3.06, 1.955, 0.003],
    ["receptions:cbs", 0.90, 2.90, 3.10, 1.960, 0.033],
    ["receptions:rotoballer", 1.00, 3.03, 3.10, 2.036, 0.068],
    ["receptions:sleeper", 0.76, 2.58, 2.95, 1.779, -0.120],

    ["rushing_touchdowns:fantasypros", 0.20, 1.09, 0.20, 0.378, 0.021],
    ["rushing_touchdowns:espn", 0.11, 0.58, 0.53, 0.332, 0.057],
    ["rushing_touchdowns:cbs", 0.00, 0.50, 0.50, 0.250, 0.046],
    ["rushing_touchdowns:rotoballer", 0.20, 0.70, 0.50, 0.390, 0.058],
    ["rushing_touchdowns:sleeper", 0.02, 0.53, 0.60, 0.298, 0.042],

    ["rushing_yards:fantasypros", 9.70, 44.85, 9.70, 16.730, 5.019],
    ["rushing_yards:espn", 8.00, 29.78, 27.03, 18.068, 4.233],
    ["rushing_yards:cbs", 4.60, 25.56, 26.40, 15.332, 2.372],
    ["rushing_yards:rotoballer", 10.20, 37.78, 26.50, 20.606, 2.359],
    ["rushing_yards:sleeper", 2.93, 25.86, 27.12, 14.775, 1.889],

    ["touchdowns:fantasypros", 0.60, 1.19, 0.60, 0.718, -0.125],
    ["touchdowns:numberfire", 0.56, 1.23, 0.66, 0.723, -0.096],
    ["touchdowns:espn", 0.24, 0.70, 0.73, 0.480, 0.059],
    ["touchdowns:cbs", 0.30, 0.74, 0.70, 0.508, 0.104],
    ["touchdowns:rotoballer", 0.20, 0.79, 0.75, 0.483, 0.049],
    ["touchdowns:sleeper", 0.23, 0.73, 0.76, 0.490, 0.070],
  ].map(([key, median, p90, recent, robust, bias]) => [
    key as string,
    {
      medianAbsoluteError: median as number,
      p90AbsoluteError: p90 as number,
      recentMedianAbsoluteError: recent as number,
      robustError: robust as number,
      bias: bias as number,
    },
  ]),
);

export type ProjectionPerformanceRow = {
  source: string;
  statistic: string;
  sampleSize: number;
  learningSampleSize: number;
  recoveredSampleSize: number;
  meanAbsoluteError: number;
  medianAbsoluteError: number;
  p90AbsoluteError: number;
  recentMedianAbsoluteError: number;
  robustError: number;
  rmse: number;
  bias: number;
  learnedTarget: number;
  confidence: number;
  examples: Array<{
    playerName: string;
    week: number;
    projectedValue: number;
    actualValue: number;
    absoluteError: number;
  }>;
  weight: number | null;
  baselineWeight: number;
  previousWeight: number | null;
  previousWeightWeek: number | null;
  weightChange: number | null;
  weightWeek: number | null;
  weightHistory: Array<{
    week: number;
    weight: number;
  }>;
};

function canonicalTeam(code: string) {
  const upper = code.trim().toUpperCase();
  if (upper === "WSH") return "WAS";
  if (upper === "JAC") return "JAX";
  if (upper === "LA") return "LAR";
  return upper;
}

function matchupKey(value: string) {
  return value
    .split(/[^A-Za-z]+/)
    .map(canonicalTeam)
    .filter(Boolean)
    .toSorted()
    .join("-");
}

function parseMoneylineSources(value: unknown) {
  if (typeof value !== "string" || !value) return [] as Array<{
    source: string;
    probabilityBps: number;
  }>;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((point): Array<{ source: string; probabilityBps: number }> => {
      if (
        !point ||
        typeof point !== "object" ||
        typeof point.source !== "string" ||
        typeof point.probabilityBps !== "number" ||
        !Number.isFinite(point.probabilityBps)
      ) {
        return [];
      }
      return [{
        source: point.source,
        probabilityBps: Math.max(1, Math.min(9_999, point.probabilityBps)),
      }];
    });
  } catch {
    return [];
  }
}

function quantile(sorted: number[], q: number) {
  if (!sorted.length) return 0;
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower] ?? 0;
  const fraction = index - lower;
  return (sorted[lower] ?? 0) * (1 - fraction) + (sorted[upper] ?? 0) * fraction;
}

function activeSlateWeek(
  games: Array<{
    week: number | null;
    status: string;
    kickoffAt: Date;
  }>,
) {
  // The Sources page should follow the actual NFL slate, not whichever source
  // happens to have written the numerically largest week. Some providers post
  // future-week rows early, which previously made the dashboard jump ahead and
  // made every current-week source look like it was not reporting.
  const pendingWeeks = games
    .filter(
      (game) =>
        game.week !== null &&
        game.week > 0 &&
        !/final/i.test(game.status),
    )
    .map((game) => game.week as number);

  if (pendingWeeks.length) return Math.min(...pendingWeeks);

  const completedWeeks = games
    .filter((game) => game.week !== null && game.week > 0)
    .map((game) => game.week as number);

  return completedWeeks.length ? Math.max(...completedWeeks) : null;
}

export async function getProjectionSourcePerformance(season = 2026) {
  try {
    const db = getDb();

    const [
      gradeRows,
      weightRows,
      latestProjectionWeekRows,
      latestProjectionRows,
      latestGradeRows,
      moneylineWeightRows,
      seasonGameRows,
    ] = await Promise.all([
      db
        .select({
          source: sourceProjections.source,
          statistic: sourceProjections.statistic,
          playerName: sourceProjections.playerName,
          week: sourceProjections.week,
          projectedValue: sourceProjections.projectedValue,
          actualValue: sourceProjectionGrades.actualValue,
          absoluteError: sourceProjectionGrades.absoluteError,
          squaredError: sourceProjectionGrades.squaredError,
          gradedAt: sourceProjectionGrades.gradedAt,
          provenance: sourceProjections.provenance,
        })
        .from(sourceProjectionGrades)
        .innerJoin(
          sourceProjections,
          eq(sourceProjectionGrades.projectionId, sourceProjections.id),
        )
        .where(eq(sourceProjections.season, season)),
      db
        .select({
          source: sourceWeightHistory.source,
          statistic: sourceWeightHistory.statistic,
          weight: sourceWeightHistory.weight,
          effectiveWeek: sourceWeightHistory.effectiveWeek,
          sampleSize: sourceWeightHistory.sampleSize,
          mae: sourceWeightHistory.mae,
          recentMae: sourceWeightHistory.recentMae,
        })
        .from(sourceWeightHistory)
        .where(eq(sourceWeightHistory.season, season))
        .orderBy(desc(sourceWeightHistory.effectiveWeek)),
      db
        .select({ week: max(sourceProjections.week) })
        .from(sourceProjections)
        .where(eq(sourceProjections.season, season)),
      db
        .select({
          source: sourceProjections.source,
          capturedAt: max(sourceProjections.latestCapturedAt),
        })
        .from(sourceProjections)
        .where(eq(sourceProjections.season, season))
        .groupBy(sourceProjections.source),
      db
        .select({
          source: sourceProjections.source,
          gradedAt: max(sourceProjectionGrades.gradedAt),
        })
        .from(sourceProjectionGrades)
        .innerJoin(
          sourceProjections,
          eq(sourceProjectionGrades.projectionId, sourceProjections.id),
        )
        .where(eq(sourceProjections.season, season))
        .groupBy(sourceProjections.source),
      db
        .select({
          source: moneylineSourceWeightHistory.source,
          weight: moneylineSourceWeightHistory.weight,
          priorWeight: moneylineSourceWeightHistory.priorWeight,
          effectiveWeek: moneylineSourceWeightHistory.effectiveWeek,
        })
        .from(moneylineSourceWeightHistory)
        .where(eq(moneylineSourceWeightHistory.season, season))
        .orderBy(desc(moneylineSourceWeightHistory.effectiveWeek)),
      db
        .select({
          week: nflGames.week,
          homeTeam: nflGames.homeTeam,
          awayTeam: nflGames.awayTeam,
          homeScore: nflGames.homeScore,
          awayScore: nflGames.awayScore,
          status: nflGames.status,
          kickoffAt: nflGames.kickoffAt,
          updatedAt: nflGames.updatedAt,
        })
        .from(nflGames)
        .where(
          and(
            eq(nflGames.season, season),
            eq(nflGames.seasonType, "REG"),
          ),
        ),
    ]);

    const coverageWeek =
      activeSlateWeek(seasonGameRows) ??
      latestProjectionWeekRows[0]?.week ??
      null;
    const coverageRows =
      coverageWeek === null
        ? []
        : await db
            .select({
              source: sourceProjections.source,
              provenance: sourceProjections.provenance,
              count: count(),
            })
            .from(sourceProjections)
            .where(
              and(
                eq(sourceProjections.season, season),
                eq(sourceProjections.week, coverageWeek),
              ),
            )
            .groupBy(sourceProjections.source, sourceProjections.provenance);
    const coverageBySource = new Map<string, number>();
    const recoveredCoverageBySource = new Map<string, number>();
    for (const row of coverageRows) {
      coverageBySource.set(
        row.source,
        (coverageBySource.get(row.source) ?? 0) + Number(row.count),
      );
      if (row.provenance !== "live_capture") {
        recoveredCoverageBySource.set(
          row.source,
          (recoveredCoverageBySource.get(row.source) ?? 0) + Number(row.count),
        );
      }
    }
    const projectionUpdatedBySource = new Map(
      latestProjectionRows.map((row) => [
        row.source,
        row.capturedAt instanceof Date
          ? row.capturedAt.toISOString()
          : row.capturedAt
            ? new Date(row.capturedAt).toISOString()
            : null,
      ]),
    );
    const gradeUpdatedBySource = new Map(
      latestGradeRows.map((row) => [
        row.source,
        row.gradedAt instanceof Date
          ? row.gradedAt.toISOString()
          : row.gradedAt
            ? new Date(row.gradedAt).toISOString()
            : null,
      ]),
    );

    const currentBaselineWeight =
      1 / Math.max(ACTIVE_PROJECTION_SOURCES.length, 1);
    const legacyBaselineByStatistic = new Map<string, number>();
    const firstWeightWeekByStatistic = new Map<string, number>();
    for (const row of weightRows) {
      const previous = firstWeightWeekByStatistic.get(row.statistic);
      if (previous === undefined || row.effectiveWeek < previous) {
        firstWeightWeekByStatistic.set(row.statistic, row.effectiveWeek);
      }
    }
    for (const [statistic, week] of firstWeightWeekByStatistic) {
      const sourcesAtStart = new Set(
        weightRows
          .filter(
            (row) =>
              row.statistic === statistic && row.effectiveWeek === week,
          )
          .map((row) => row.source),
      );
      if (sourcesAtStart.size) {
        legacyBaselineByStatistic.set(statistic, 1 / sourcesAtStart.size);
      }
    }

    const weightHistoryByKey = new Map<
      string,
      Array<{
        week: number;
        weight: number;
        sampleSize: number;
        mae: number | null;
        recentMae: number | null;
      }>
    >();

    for (const row of weightRows) {
      const key = `${row.statistic}:${row.source}`;
      const history = weightHistoryByKey.get(key) ?? [];
      if (!history.some((item) => item.week === row.effectiveWeek)) {
        history.push({
          week: row.effectiveWeek,
          weight: row.weight,
          sampleSize: row.sampleSize,
          mae: row.mae,
          recentMae: row.recentMae,
        });
      }
      weightHistoryByKey.set(key, history);
    }

    for (const history of weightHistoryByKey.values()) {
      history.sort((first, second) => first.week - second.week);
    }

    const groups = new Map<
      string,
      {
        source: string;
        statistic: string;
        abs: number[];
        squared: number[];
        signed: number[];
        recoveredCount: number;
        recent: Array<{
          error: number;
          gradedAt: number;
          playerName: string;
          week: number;
          projectedValue: number;
          actualValue: number;
        }>;
      }
    >();

    for (const row of gradeRows) {
      if (
        !ACTIVE_PROJECTION_SOURCES.includes(
          row.source as (typeof ACTIVE_PROJECTION_SOURCES)[number],
        )
      ) {
        continue;
      }
      const key = `${row.statistic}:${row.source}`;
      const group =
        groups.get(key) ??
        {
          source: row.source,
          statistic: row.statistic,
          abs: [],
          squared: [],
          signed: [],
          recoveredCount: 0,
          recent: [],
        };
      group.abs.push(row.absoluteError);
      group.squared.push(row.squaredError);
      group.signed.push(row.projectedValue - row.actualValue);
      if (row.provenance !== "live_capture") group.recoveredCount += 1;
      group.recent.push({
        error: row.absoluteError,
        gradedAt: row.gradedAt.getTime(),
        playerName: row.playerName,
        week: row.week,
        projectedValue: row.projectedValue,
        actualValue: row.actualValue,
      });
      groups.set(key, group);
    }

    const baseRows = [...groups.values()].map(
      (group) => {
        const abs = group.abs.toSorted((a, b) => a - b);
        const weightKey = `${group.statistic}:${group.source}`;
        const weightHistory = weightHistoryByKey.get(weightKey) ?? [];
        const latestWeight = weightHistory.at(-1) ?? null;
        const priorWeight = weightHistory.at(-2) ?? null;
        const baselineWeight =
          latestWeight
            ? legacyBaselineByStatistic.get(group.statistic) ??
              currentBaselineWeight
            : currentBaselineWeight;
        const previousWeight = latestWeight
          ? priorWeight?.weight ?? baselineWeight
          : null;
        const sampleSize = abs.length;
        const medianAbsoluteError = quantile(abs, 0.5);
        const p90AbsoluteError = quantile(abs, 0.9);
        const recentErrors = group.recent
          .toSorted((a, b) => b.gradedAt - a.gradedAt)
          .slice(0, 40)
          .map((row) => row.error)
          .toSorted((a, b) => a - b);
        const recentMedianAbsoluteError = recentErrors.length
          ? quantile(recentErrors, 0.5)
          : medianAbsoluteError;
        const recoveredRobustError =
          0.5 * medianAbsoluteError +
          0.3 * recentMedianAbsoluteError +
          0.2 * p90AbsoluteError;
        const legacyMetric =
          latestWeight?.week === 3
            ? LEGACY_WEEK3_PERFORMANCE.get(weightKey) ?? null
            : null;

        return {
          source: group.source,
          statistic: group.statistic,
          sampleSize,
          learningSampleSize: latestWeight?.sampleSize ?? 0,
          recoveredSampleSize: group.recoveredCount,
          meanAbsoluteError:
            legacyMetric && latestWeight?.mae !== null && latestWeight?.mae !== undefined
              ? latestWeight.mae
              : group.abs.reduce((sum, value) => sum + value, 0) /
                Math.max(sampleSize, 1),
          medianAbsoluteError:
            legacyMetric?.medianAbsoluteError ?? medianAbsoluteError,
          p90AbsoluteError:
            legacyMetric?.p90AbsoluteError ?? p90AbsoluteError,
          recentMedianAbsoluteError:
            legacyMetric?.recentMedianAbsoluteError ??
            recentMedianAbsoluteError,
          robustError: legacyMetric?.robustError ?? recoveredRobustError,
          rmse: Math.sqrt(
            group.squared.reduce((sum, value) => sum + value, 0) /
              Math.max(sampleSize, 1),
          ),
          bias:
            legacyMetric?.bias ??
            group.signed.reduce((sum, value) => sum + value, 0) /
              Math.max(sampleSize, 1),
          examples: group.recent
            .toSorted((a, b) => b.gradedAt - a.gradedAt)
            .slice(0, 3)
            .map((example) => ({
              playerName: example.playerName,
              week: example.week,
              projectedValue: example.projectedValue,
              actualValue: example.actualValue,
              absoluteError: example.error,
            })),
          weight: latestWeight?.weight ?? baselineWeight,
          baselineWeight,
          previousWeight,
          previousWeightWeek: priorWeight?.week ?? null,
          weightChange:
            latestWeight && previousWeight !== null
              ? latestWeight.weight - previousWeight
              : null,
          weightWeek: latestWeight?.week ?? null,
          weightHistory,
        };
      },
    );

    const performanceTotals = new Map<string, number>();
    for (const row of baseRows) {
      const strength = 1 / Math.max(row.robustError, 0.25);
      performanceTotals.set(
        row.statistic,
        (performanceTotals.get(row.statistic) ?? 0) + strength,
      );
    }

    const rows: ProjectionPerformanceRow[] = baseRows.map((row) => {
      const strength = 1 / Math.max(row.robustError, 0.25);
      const total = performanceTotals.get(row.statistic) ?? strength;
      return {
        ...row,
        learnedTarget: total > 0 ? strength / total : 1 / 6,
        confidence: clamp((row.learningSampleSize - 20) / 180, 0, 0.75),
      };
    });

    const seasonPredictionStart = new Date(Date.UTC(season, 7, 1));
    const moneylinePredictionRows = await db
      .select({
        features: predictions.features,
        predictedAt: predictions.predictedAt,
      })
      .from(predictions)
      .innerJoin(
        normalizedMarkets,
        eq(normalizedMarkets.id, predictions.normalizedMarketId),
      )
      .where(
        and(
          eq(normalizedMarkets.family, "moneyline"),
          gte(predictions.predictedAt, seasonPredictionStart),
        ),
      )
      .orderBy(desc(predictions.predictedAt))
      .limit(25_000);

    const finalGames = new Map<
      string,
      {
        winner: string | null;
        kickoffAt: Date;
        gradedAt: Date;
      }
    >();
    for (const game of seasonGameRows) {
      if (
        game.week === null ||
        game.homeScore === null ||
        game.awayScore === null ||
        !/final/i.test(game.status)
      ) {
        continue;
      }
      const matchup = matchupKey(`${game.homeTeam}-${game.awayTeam}`);
      const winner =
        game.homeScore === game.awayScore
          ? null
          : canonicalTeam(
              game.homeScore > game.awayScore
                ? game.homeTeam
                : game.awayTeam,
            );
      finalGames.set(`${game.week}:${matchup}`, {
        winner,
        kickoffAt: game.kickoffAt,
        gradedAt: game.updatedAt,
      });
    }

    type MoneylineSample = {
      source: string;
      week: number;
      matchup: string;
      subject: string;
      probabilityBps: number;
      outcome: 0 | 0.5 | 1;
      predictedAt: Date;
      gradedAt: Date;
    };

    const latestBySourceGame = new Map<string, MoneylineSample>();
    const coverageByMoneylineSource = new Map<string, Set<string>>();
    const latestMoneylineCapture = new Map<string, Date>();
    const latestMoneylineGrade = new Map<string, Date>();

    for (const row of moneylinePredictionRows) {
      const features = row.features;
      if (
        features.live === true ||
        features.projectionSeason !== season ||
        typeof features.projectionWeek !== "number" ||
        typeof features.matchup !== "string" ||
        typeof features.subject !== "string"
      ) {
        continue;
      }

      const week = features.projectionWeek;
      const matchup = matchupKey(features.matchup);
      const subject = canonicalTeam(features.subject);
      if (!matchup || !subject) continue;

      const points = parseMoneylineSources(features.gameProjectionSourcesJson);
      for (const point of points) {
        if (
          !MONEYLINE_SOURCE_IDS.includes(
            point.source as (typeof MONEYLINE_SOURCE_IDS)[number],
          )
        ) {
          continue;
        }

        const captured = latestMoneylineCapture.get(point.source);
        if (!captured || row.predictedAt > captured) {
          latestMoneylineCapture.set(point.source, row.predictedAt);
        }

        if (coverageWeek !== null && week === coverageWeek) {
          const covered = coverageByMoneylineSource.get(point.source) ?? new Set<string>();
          covered.add(matchup);
          coverageByMoneylineSource.set(point.source, covered);
        }

        const final = finalGames.get(`${week}:${matchup}`);
        if (!final || row.predictedAt >= final.kickoffAt) continue;

        const sampleKey = `${week}:${matchup}:${point.source}`;
        if (latestBySourceGame.has(sampleKey)) continue;

        const outcome: 0 | 0.5 | 1 =
          final.winner === null
            ? 0.5
            : final.winner === subject
              ? 1
              : 0;
        latestBySourceGame.set(sampleKey, {
          source: point.source,
          week,
          matchup,
          subject,
          probabilityBps: point.probabilityBps,
          outcome,
          predictedAt: row.predictedAt,
          gradedAt: final.gradedAt,
        });

        const graded = latestMoneylineGrade.get(point.source);
        if (!graded || final.gradedAt > graded) {
          latestMoneylineGrade.set(point.source, final.gradedAt);
        }
      }
    }

    const samplesByMoneylineSource = new Map<string, MoneylineSample[]>();
    for (const sample of latestBySourceGame.values()) {
      const samples = samplesByMoneylineSource.get(sample.source) ?? [];
      samples.push(sample);
      samplesByMoneylineSource.set(sample.source, samples);
    }

    const moneylineRows: MoneylinePerformanceRow[] = MONEYLINE_SOURCE_IDS.flatMap(
      (source) => {
        const samples = samplesByMoneylineSource.get(source) ?? [];
        if (!samples.length) return [];
        const sourceWeights = moneylineWeightRows.filter(
          (row) => row.source === source,
        );
        const currentWeight = sourceWeights[0] ?? null;
        const previousWeight = sourceWeights.find(
          (row) => row.effectiveWeek !== currentWeight?.effectiveWeek,
        ) ?? null;

        let brierTotal = 0;
        let accuracyTotal = 0;
        let logLossTotal = 0;
        for (const sample of samples) {
          const probability = clamp(sample.probabilityBps / 10_000, 0.001, 0.999);
          const outcome = sample.outcome;
          brierTotal += (probability - outcome) ** 2;
          accuracyTotal +=
            outcome === 0.5
              ? 0.5
              : (probability >= 0.5) === (outcome === 1)
                ? 1
                : 0;
          logLossTotal +=
            -(outcome * Math.log(probability) +
              (1 - outcome) * Math.log(1 - probability));
        }

        return [{
          source,
          sampleSize: samples.length,
          brierScore: brierTotal / samples.length,
          accuracy: accuracyTotal / samples.length,
          logLoss: logLossTotal / samples.length,
          weight: currentWeight?.weight ?? null,
          priorWeight:
            currentWeight?.priorWeight ??
            MONEYLINE_WEIGHT_PRIORS[source as MoneylineSource],
          effectiveWeek: currentWeight?.effectiveWeek ?? null,
          previousWeight: previousWeight?.weight ?? null,
          previousEffectiveWeek: previousWeight?.effectiveWeek ?? null,
          examples: samples
            .toSorted((first, second) =>
              second.week - first.week ||
              second.predictedAt.getTime() - first.predictedAt.getTime(),
            )
            .slice(0, 3)
            .map((sample) => ({
              week: sample.week,
              matchup: sample.matchup,
              subject: sample.subject,
              probabilityBps: sample.probabilityBps,
              outcome: sample.outcome,
            })),
        }];
      },
    ).toSorted(
      (first, second) =>
        first.brierScore - second.brierScore ||
        second.sampleSize - first.sampleSize,
    );

    return {
      season,
      rows,
      moneylineRows,
      coverageWeek,
      sources: [
        ...ACTIVE_PROJECTION_SOURCES.map((source) => ({
          id: source,
          ...PROJECTION_SOURCE_INFO[source],
          moneylineOnly: false,
          coverageCount: coverageBySource.get(source) ?? 0,
          recoveredCoverageCount: recoveredCoverageBySource.get(source) ?? 0,
          lastCapturedAt: projectionUpdatedBySource.get(source) ?? null,
          lastGradedAt: gradeUpdatedBySource.get(source) ?? null,
        })),
        ...MONEYLINE_SOURCE_IDS.map((source) => ({
          id: source,
          ...MONEYLINE_SOURCE_INFO[source],
          moneylineOnly: true,
          coverageCount: coverageByMoneylineSource.get(source)?.size ?? 0,
          recoveredCoverageCount: 0,
          lastCapturedAt:
            latestMoneylineCapture.get(source)?.toISOString() ?? null,
          lastGradedAt:
            latestMoneylineGrade.get(source)?.toISOString() ?? null,
        })),
      ],
    };
  } catch (error) {
    console.error("Projection source performance unavailable", error);
    return {
      season,
      rows: [] as ProjectionPerformanceRow[],
      moneylineRows: [] as MoneylinePerformanceRow[],
      coverageWeek: null as number | null,
      sources: [
        ...ACTIVE_PROJECTION_SOURCES.map((source) => ({
          id: source,
          ...PROJECTION_SOURCE_INFO[source],
          moneylineOnly: false,
          coverageCount: 0,
          recoveredCoverageCount: 0,
          lastCapturedAt: null as string | null,
          lastGradedAt: null as string | null,
        })),
        ...MONEYLINE_SOURCE_IDS.map((source) => ({
          id: source,
          ...MONEYLINE_SOURCE_INFO[source],
          moneylineOnly: true,
          coverageCount: 0,
          recoveredCoverageCount: 0,
          lastCapturedAt: null as string | null,
          lastGradedAt: null as string | null,
        })),
      ],
    };
  }
}
