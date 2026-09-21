import "server-only";

import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  marketListings,
  normalizedMarkets,
  predictionResults,
  predictions,
} from "@/db/schema";
import { recommendedPredictionPerspective } from "./prediction-perspective";

export type ScorecardPick = {
  id: string;
  rank: number;
  title: string;
  context: string;
  side: "yes" | "no";
  probabilityBps: number;
  executablePriceBps: number;
  edgeBps: number;
  score: number;
  frozenAt: string;
  settledAt: string | null;
  result: "hit" | "miss" | "pending";
  profitOnTen: number | null;
};

export type WeeklyScorecard = {
  key: string;
  label: string;
  season: number | null;
  week: number | null;
  picks: ScorecardPick[];
  settled: number;
  hits: number;
  misses: number;
  profitOnTen: number;
  roi: number;
};

function weekStart(date: Date) {
  const copy = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = copy.getUTCDay();
  copy.setUTCDate(copy.getUTCDate() - (day === 0 ? 6 : day - 1));
  return copy;
}

function weekIdentity(
  features: Record<string, number | string | boolean | null>,
  fallback: Date,
) {
  const season =
    typeof features.projectionSeason === "number"
      ? features.projectionSeason
      : null;
  const week =
    typeof features.projectionWeek === "number"
      ? features.projectionWeek
      : null;
  if (season && week) {
    return {
      key: `${season}-week-${week}`,
      label: `NFL Week ${week}`,
      season,
      week,
    };
  }

  const start = weekStart(fallback);
  return {
    key: start.toISOString().slice(0, 10),
    label: `Week of ${new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(start)}`,
    season: fallback.getUTCFullYear(),
    week: null,
  };
}

const FAMILY_LABELS: Record<string, string> = {
  passing_yards: "passing yards",
  passing_touchdowns: "passing TDs",
  passing_interceptions: "interceptions",
  rushing_yards: "rushing yards",
  rushing_touchdowns: "rushing TDs",
  receiving_yards: "receiving yards",
  receiving_touchdowns: "receiving TDs",
  receptions: "receptions",
  longest_reception: "longest reception",
  touchdowns: "anytime touchdown",
};

function pickTitle(input: {
  family: string;
  direction: string;
  threshold: number | null;
  outcomeLabel: string;
  marketTitle: string;
  subject: string | null;
  side: "yes" | "no";
}) {
  if (input.family === "moneyline") {
    return input.side === "yes"
      ? `${input.subject ?? input.outcomeLabel} to win`
      : `No on ${input.outcomeLabel}`;
  }
  const direction =
    input.side === "yes"
      ? input.direction
      : input.direction === "over"
        ? "under"
        : input.direction === "under"
          ? "over"
          : input.direction === "yes"
            ? "no"
            : "yes";
  const prefix =
    direction === "over"
      ? "Over"
      : direction === "under"
        ? "Under"
        : direction === "yes"
          ? "Yes"
          : "No";
  const family = FAMILY_LABELS[input.family] ?? input.family.replaceAll("_", " ");
  if (input.subject) {
    return `${input.subject} · ${prefix}${input.threshold === null ? "" : ` ${input.threshold}`} ${family}`;
  }
  return input.side === "yes" ? input.marketTitle : `No · ${input.marketTitle}`;
}

export async function getWeeklyScorecards(): Promise<WeeklyScorecard[]> {
  try {
    const db = getDb();
    const rows = await db
      .select({
        id: predictions.id,
        normalizedMarketId: predictions.normalizedMarketId,
        predictedProbabilityBps: predictions.predictedProbabilityBps,
        executablePriceBps: predictions.executablePriceBps,
        edgeBps: predictions.edgeBps,
        opportunityScore: predictions.opportunityScore,
        features: predictions.features,
        predictedAt: predictions.predictedAt,
        outcome: predictionResults.outcome,
        settledAt: predictionResults.settledAt,
        eventTitle: marketListings.eventTitle,
        marketTitle: marketListings.marketTitle,
        family: normalizedMarkets.family,
        direction: normalizedMarkets.direction,
        threshold: normalizedMarkets.threshold,
        outcomeLabel: normalizedMarkets.outcomeLabel,
        settlementAt: normalizedMarkets.settlementAt,
      })
      .from(predictions)
      .innerJoin(
        marketListings,
        eq(marketListings.id, predictions.listingId),
      )
      .innerJoin(
        normalizedMarkets,
        eq(normalizedMarkets.id, predictions.normalizedMarketId),
      )
      .leftJoin(
        predictionResults,
        eq(predictionResults.predictionId, predictions.id),
      )
      .orderBy(desc(predictions.predictedAt))
      .limit(3_000);

    const latestByMarket = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (row.features.live === true) continue;
      if (!latestByMarket.has(row.normalizedMarketId)) {
        latestByMarket.set(row.normalizedMarketId, row);
      }
    }

    const grouped = new Map<
      string,
      {
        identity: ReturnType<typeof weekIdentity>;
        candidates: Array<(typeof rows)[number]>;
      }
    >();
    for (const row of latestByMarket.values()) {
      const identity = weekIdentity(
        row.features,
        row.settlementAt ?? row.predictedAt,
      );
      const group = grouped.get(identity.key) ?? {
        identity,
        candidates: [],
      };
      group.candidates.push(row);
      grouped.set(identity.key, group);
    }

    return [...grouped.values()]
      .map(({ identity, candidates }) => {
        const distinct = new Map<string, (typeof candidates)[number]>();
        for (const candidate of candidates.toSorted(
          (a, b) =>
            b.opportunityScore - a.opportunityScore ||
            b.edgeBps - a.edgeBps,
        )) {
          const subject =
            typeof candidate.features.subject === "string"
              ? candidate.features.subject
              : "";
          const matchup =
            typeof candidate.features.matchup === "string"
              ? candidate.features.matchup
              : candidate.eventTitle;
          const perspective = recommendedPredictionPerspective(candidate);
          const key = [
            matchup,
            candidate.family,
            subject,
            perspective.side,
          ].join(":");
          if (!distinct.has(key)) distinct.set(key, candidate);
        }

        const top = [...distinct.values()].slice(0, 10);
        const picks: ScorecardPick[] = top.map((row, index) => {
          const perspective = recommendedPredictionPerspective(row);
          const result =
            row.outcome === null
              ? "pending"
              : row.outcome === 1
                ? "hit"
                : "miss";
          const profitOnTen =
            row.outcome === null
              ? null
              : row.outcome === 1
                ? row.executablePriceBps > 0
                  ? 10 * (10_000 / row.executablePriceBps - 1)
                  : null
                : -10;
          const subject =
            typeof row.features.subject === "string"
              ? row.features.subject
              : null;
          return {
            id: row.id,
            rank: index + 1,
            title: pickTitle({
              family: row.family,
              direction: row.direction,
              threshold: row.threshold,
              outcomeLabel: row.outcomeLabel,
              marketTitle: row.marketTitle,
              subject,
              side: perspective.side,
            }),
            context: row.eventTitle,
            side: perspective.side,
            probabilityBps: perspective.probabilityBps,
            executablePriceBps: row.executablePriceBps,
            edgeBps: row.edgeBps,
            score: row.opportunityScore,
            frozenAt: row.predictedAt.toISOString(),
            settledAt: row.settledAt?.toISOString() ?? null,
            result,
            profitOnTen,
          };
        });
        const settledPicks = picks.filter((pick) => pick.profitOnTen !== null);
        const profitOnTen = settledPicks.reduce(
          (sum, pick) => sum + (pick.profitOnTen ?? 0),
          0,
        );
        const settled = settledPicks.length;
        const hits = picks.filter((pick) => pick.result === "hit").length;
        return {
          ...identity,
          picks,
          settled,
          hits,
          misses: picks.filter((pick) => pick.result === "miss").length,
          profitOnTen,
          roi: settled ? profitOnTen / (settled * 10) : 0,
        };
      })
      .filter((week) => week.picks.length > 0)
      .toSorted((a, b) => b.key.localeCompare(a.key))
      .slice(0, 12);
  } catch (error) {
    console.error("Weekly scorecards unavailable", error);
    return [];
  }
}
