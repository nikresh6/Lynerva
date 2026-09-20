import "server-only";

import { and, count, desc, eq, max } from "drizzle-orm";
import { getDb } from "@/db";
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
    note: "Weekly player stat projections. Lynerva rejects the page unless it explicitly matches the requested NFL week.",
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
    note: "Lynerva accepts only the exact requested scoring period from ESPN's public fantasy feed.",
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
    note: "Weekly stat lines from Sleeper's public projection endpoint. Lynerva ignores bye/filler rows and requires a real game plus a published projection.",
  },
} as const;

export type ProjectionPerformanceRow = {
  source: string;
  statistic: string;
  sampleSize: number;
  medianAbsoluteError: number;
  p90AbsoluteError: number;
  recentMedianAbsoluteError: number;
  robustError: number;
  rmse: number;
  bias: number;
  weight: number | null;
  previousWeight: number | null;
  weightChange: number | null;
  weightWeek: number | null;
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

    const [gradeRows, weightRows, latestProjectionWeekRows] = await Promise.all([
      db
        .select({
          source: sourceProjections.source,
          statistic: sourceProjections.statistic,
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

    const latestWeights = new Map<
      string,
      { weight: number; effectiveWeek: number }
    >();
    const previousWeights = new Map<string, number>();
    const seenWeightWeeks = new Map<string, Set<number>>();

    for (const row of weightRows) {
      const key = `${row.statistic}:${row.source}`;
      const weeks = seenWeightWeeks.get(key) ?? new Set<number>();

      if (!latestWeights.has(key)) {
        latestWeights.set(key, {
          weight: row.weight,
          effectiveWeek: row.effectiveWeek,
        });
        weeks.add(row.effectiveWeek);
        seenWeightWeeks.set(key, weeks);
        continue;
      }

      const latestWeek = latestWeights.get(key)!.effectiveWeek;
      if (
        row.effectiveWeek !== latestWeek &&
        !previousWeights.has(key)
      ) {
        previousWeights.set(key, row.weight);
      }
      weeks.add(row.effectiveWeek);
      seenWeightWeeks.set(key, weeks);
    }

    const groups = new Map<
      string,
      {
        source: string;
        statistic: string;
        abs: number[];
        squared: number[];
        signed: number[];
        recent: Array<{ error: number; gradedAt: number }>;
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
      });
      groups.set(key, group);
    }

    const rows: ProjectionPerformanceRow[] = [...groups.values()].map(
      (group) => {
        const abs = group.abs.toSorted((a, b) => a - b);
        const weightKey = `${group.statistic}:${group.source}`;
        const weight = latestWeights.get(weightKey);
        const previousWeight = previousWeights.get(weightKey) ?? null;
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
          weight: weight?.weight ?? null,
          previousWeight,
          weightChange:
            weight && previousWeight !== null
              ? weight.weight - previousWeight
              : null,
          weightWeek: weight?.effectiveWeek ?? null,
        };
      },
    );

    return {
      season,
      rows,
      coverageWeek,
      sources: ACTIVE_PROJECTION_SOURCES.map((source) => ({
        id: source,
        ...PROJECTION_SOURCE_INFO[source],
        coverageCount: coverageBySource.get(source) ?? 0,
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
      })),
    };
  }
}
