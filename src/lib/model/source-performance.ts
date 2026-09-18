import "server-only";

import { desc, eq } from "drizzle-orm";
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
    access: "Free public weekly tables",
    note: "Weekly player stat projections. Lynerva rejects the page unless it explicitly matches the requested NFL week.",
  },
  numberfire: {
    name: "numberFire",
    kind: "Public weekly projection site",
    href: "https://www.numberfire.com/nfl/fantasy/fantasy-football-projections",
    access: "Free public weekly tables",
    note: "Weekly player projections from the public numberFire widgets. Wrong-week responses are discarded.",
  },
  espn: {
    name: "ESPN",
    kind: "Public fantasy projection feed",
    href: "https://fantasy.espn.com/football/",
    access: "No paid key or account used",
    note: "Lynerva accepts only the exact requested scoring period from ESPN's public fantasy feed.",
  },
  cbs: {
    name: "CBS Sports",
    kind: "Public weekly projection site",
    href: "https://www.cbssports.com/fantasy/football/stats/",
    access: "Free public weekly tables",
    note: "Position-specific weekly stat projections. Rest-of-season and season views are rejected.",
  },
  rotoballer: {
    name: "RotoBaller",
    kind: "Public weekly projection site",
    href: "https://www.rotoballer.com/category/nfl/fantasy-football-advice-analysis/fantasy-football-projections-articles-analysis",
    access: "Free public weekly article",
    note: "Weekly stat-line projection table parsed only when the article title and season match the requested week.",
  },
  nfl: {
    name: "NFL Fantasy",
    kind: "Public weekly projection site",
    href: "https://fantasy.nfl.com/research/projections",
    access: "Free public weekly tables",
    note: "NFL Fantasy's public weekly projection table. Lynerva requests the exact season and week and never substitutes season projections.",
  },
  sleeper: {
    name: "Sleeper",
    kind: "Public projection API",
    href: "https://sleeper.com/",
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
  rmse: number;
  bias: number;
  weight: number | null;
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

    const [gradeRows, weightRows] = await Promise.all([
      db
        .select({
          source: sourceProjections.source,
          statistic: sourceProjections.statistic,
          projectedValue: sourceProjections.projectedValue,
          actualValue: sourceProjectionGrades.actualValue,
          absoluteError: sourceProjectionGrades.absoluteError,
          squaredError: sourceProjectionGrades.squaredError,
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
    ]);

    const latestWeights = new Map<
      string,
      { weight: number; effectiveWeek: number }
    >();
    for (const row of weightRows) {
      const key = `${row.statistic}:${row.source}`;
      if (!latestWeights.has(key)) {
        latestWeights.set(key, {
          weight: row.weight,
          effectiveWeek: row.effectiveWeek,
        });
      }
    }

    const groups = new Map<
      string,
      {
        source: string;
        statistic: string;
        abs: number[];
        squared: number[];
        signed: number[];
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
        };
      group.abs.push(row.absoluteError);
      group.squared.push(row.squaredError);
      group.signed.push(row.projectedValue - row.actualValue);
      groups.set(key, group);
    }

    const rows: ProjectionPerformanceRow[] = [...groups.values()].map(
      (group) => {
        const abs = group.abs.toSorted((a, b) => a - b);
        const weight = latestWeights.get(
          `${group.statistic}:${group.source}`,
        );
        const sampleSize = abs.length;
        return {
          source: group.source,
          statistic: group.statistic,
          sampleSize,
          medianAbsoluteError: quantile(abs, 0.5),
          p90AbsoluteError: quantile(abs, 0.9),
          rmse: Math.sqrt(
            group.squared.reduce((sum, value) => sum + value, 0) /
              Math.max(sampleSize, 1),
          ),
          bias:
            group.signed.reduce((sum, value) => sum + value, 0) /
            Math.max(sampleSize, 1),
          weight: weight?.weight ?? null,
          weightWeek: weight?.effectiveWeek ?? null,
        };
      },
    );

    return {
      season,
      rows,
      sources: ACTIVE_PROJECTION_SOURCES.map((source) => ({
        id: source,
        ...PROJECTION_SOURCE_INFO[source],
      })),
    };
  } catch (error) {
    console.error("Projection source performance unavailable", error);
    return {
      season,
      rows: [] as ProjectionPerformanceRow[],
      sources: ACTIVE_PROJECTION_SOURCES.map((source) => ({
        id: source,
        ...PROJECTION_SOURCE_INFO[source],
      })),
    };
  }
}
