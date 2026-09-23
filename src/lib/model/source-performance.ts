import "server-only";

import { and, count, desc, eq, max } from "drizzle-orm";
import { getDb } from "@/db";
import { clamp } from "@/lib/utils";
import {
  sourceProjectionGrades,
  sourceProjections,
  sourceWeightHistory,
} from "@/db/schema";
import { ensureSourceLearningSchema } from "./source-learning";
import { ACTIVE_PROJECTION_SOURCES } from "./source-weighting";

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
} as const;

export type ProjectionPerformanceRow = {
  source: string;
  statistic: string;
  sampleSize: number;
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

function quantile(sorted: number[], q: number) {
  if (!sorted.length) return 0;
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower] ?? 0;
  const fraction = index - lower;
  return (sorted[lower] ?? 0) * (1 - fraction) + (sorted[upper] ?? 0) * fraction;
}

export async function getProjectionSourcePerformance(season = 2026) {
  try {
    await ensureSourceLearningSchema();
    const db = getDb();

    const [
      gradeRows,
      weightRows,
      latestProjectionWeekRows,
      latestProjectionRows,
      latestGradeRows,
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
          capturedAt: max(sourceProjections.capturedAt),
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
    ]);

    const coverageWeek = latestProjectionWeekRows[0]?.week ?? null;
    const coverageRows =
      coverageWeek === null
        ? []
        : await db
            .select({
              source: sourceProjections.source,
              count: count(),
            })
            .from(sourceProjections)
            .where(
              and(
                eq(sourceProjections.season, season),
                eq(sourceProjections.week, coverageWeek),
              ),
            )
            .groupBy(sourceProjections.source);
    const coverageBySource = new Map(
      coverageRows.map((row) => [row.source, Number(row.count)]),
    );
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

    const baselineWeight = 1 / Math.max(ACTIVE_PROJECTION_SOURCES.length, 1);
    const weightHistoryByKey = new Map<
      string,
      Array<{ week: number; weight: number }>
    >();

    for (const row of weightRows) {
      const key = `${row.statistic}:${row.source}`;
      const history = weightHistoryByKey.get(key) ?? [];
      if (!history.some((item) => item.week === row.effectiveWeek)) {
        history.push({ week: row.effectiveWeek, weight: row.weight });
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
          recent: [],
        };
      group.abs.push(row.absoluteError);
      group.squared.push(row.squaredError);
      group.signed.push(row.projectedValue - row.actualValue);
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
        const robustError =
          0.5 * medianAbsoluteError +
          0.3 * recentMedianAbsoluteError +
          0.2 * p90AbsoluteError;

        return {
          source: group.source,
          statistic: group.statistic,
          sampleSize,
          meanAbsoluteError:
            group.abs.reduce((sum, value) => sum + value, 0) /
            Math.max(sampleSize, 1),
          medianAbsoluteError,
          p90AbsoluteError,
          recentMedianAbsoluteError,
          robustError,
          rmse: Math.sqrt(
            group.squared.reduce((sum, value) => sum + value, 0) /
              Math.max(sampleSize, 1),
          ),
          bias:
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
          weight: latestWeight?.weight ?? null,
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
        confidence: clamp((row.sampleSize - 20) / 180, 0, 0.75),
      };
    });

    return {
      season,
      rows,
      coverageWeek,
      sources: ACTIVE_PROJECTION_SOURCES.map((source) => ({
        id: source,
        ...PROJECTION_SOURCE_INFO[source],
        coverageCount: coverageBySource.get(source) ?? 0,
        lastCapturedAt: projectionUpdatedBySource.get(source) ?? null,
        lastGradedAt: gradeUpdatedBySource.get(source) ?? null,
      })),
    };
  } catch (error) {
    console.error("Projection source performance unavailable", error);
    return {
      season,
      rows: [] as ProjectionPerformanceRow[],
      coverageWeek: null as number | null,
      sources: ACTIVE_PROJECTION_SOURCES.map((source) => ({
        id: source,
        ...PROJECTION_SOURCE_INFO[source],
        coverageCount: 0,
        lastCapturedAt: null as string | null,
        lastGradedAt: null as string | null,
      })),
    };
  }
}
