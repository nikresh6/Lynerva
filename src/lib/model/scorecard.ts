import "server-only";

import { and, asc, desc, eq, gte } from "drizzle-orm";
import { getDb } from "@/db";
import {
  marketListings,
  nflGames,
  normalizedMarkets,
  predictionResults,
  predictions,
  weeklyScorecardPicks,
} from "@/db/schema";
import { recommendedPredictionPerspective } from "./prediction-perspective";

const SCORECARD_LAUNCH_AT = new Date("2026-09-21T02:46:31.000Z");
const LOCK_SCAN_WINDOW_MS = 14 * 24 * 60 * 60_000;

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

function canonicalTeamCode(code: string) {
  const upper = code.trim().toUpperCase();
  if (upper === "WSH") return "WAS";
  if (upper === "JAC") return "JAX";
  if (upper === "LA") return "LAR";
  return upper;
}

function matchupKey(value: string) {
  return value
    .split("-")
    .map(canonicalTeamCode)
    .filter(Boolean)
    .toSorted()
    .join("-");
}

function publicScore(features: Record<string, number | string | boolean | null>) {
  return typeof features.lynervaScore === "number"
    ? features.lynervaScore
    : null;
}

async function lockEligibleScorecards() {
  const db = getDb();
  const now = new Date();

  const alreadyLocked = await db
    .select({
      season: weeklyScorecardPicks.season,
      week: weeklyScorecardPicks.week,
    })
    .from(weeklyScorecardPicks);
  const lockedKeys = new Set(
    alreadyLocked.map((row) => `${row.season}:${row.week}`),
  );

  const scanFrom = new Date(
    Math.max(
      SCORECARD_LAUNCH_AT.getTime(),
      now.getTime() - LOCK_SCAN_WINDOW_MS,
    ),
  );

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
      eventTitle: marketListings.eventTitle,
      marketTitle: marketListings.marketTitle,
      family: normalizedMarkets.family,
      direction: normalizedMarkets.direction,
      threshold: normalizedMarkets.threshold,
      outcomeLabel: normalizedMarkets.outcomeLabel,
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
    .where(gte(predictions.predictedAt, scanFrom))
    .orderBy(desc(predictions.predictedAt));

  const grouped = new Map<
    string,
    {
      season: number;
      week: number;
      candidates: typeof rows;
    }
  >();

  for (const row of rows) {
    if (row.features.live === true) continue;
    const season =
      typeof row.features.projectionSeason === "number"
        ? row.features.projectionSeason
        : null;
    const week =
      typeof row.features.projectionWeek === "number"
        ? row.features.projectionWeek
        : null;
    if (!season || !week || publicScore(row.features) === null) continue;

    const key = `${season}:${week}`;
    if (lockedKeys.has(key)) continue;
    const group = grouped.get(key) ?? { season, week, candidates: [] };
    group.candidates.push(row);
    grouped.set(key, group);
  }

  for (const { season, week, candidates } of grouped.values()) {
    const key = `${season}:${week}`;
    if (lockedKeys.has(key)) continue;

    const games = await db
      .select({
        kickoffAt: nflGames.kickoffAt,
        homeTeam: nflGames.homeTeam,
        awayTeam: nflGames.awayTeam,
      })
      .from(nflGames)
      .where(
        and(
          eq(nflGames.season, season),
          eq(nflGames.week, week),
          eq(nflGames.seasonType, "REG"),
        ),
      );

    if (!games.length) continue;
    const firstKickoffMs = Math.min(
      ...games.map((game) => game.kickoffAt.getTime()),
    );
    if (now.getTime() < firstKickoffMs) continue;

    const kickoffByMatchup = new Map(
      games.map((game) => [
        matchupKey(`${game.homeTeam}-${game.awayTeam}`),
        game.kickoffAt,
      ]),
    );

    let lockAt = new Date(firstKickoffMs);
    if (SCORECARD_LAUNCH_AT.getTime() > firstKickoffMs) {
      const firstEligibleCapture = candidates
        .map((candidate) => candidate.predictedAt.getTime())
        .filter((value) => value >= SCORECARD_LAUNCH_AT.getTime())
        .toSorted((a, b) => a - b)[0];
      if (firstEligibleCapture === undefined) continue;
      lockAt = new Date(firstEligibleCapture);
    }

    const latestByMarket = new Map<string, (typeof candidates)[number]>();
    for (const candidate of candidates) {
      if (candidate.predictedAt.getTime() > lockAt.getTime()) continue;
      if (candidate.predictedAt.getTime() < SCORECARD_LAUNCH_AT.getTime()) {
        continue;
      }

      const matchup =
        typeof candidate.features.matchup === "string"
          ? matchupKey(candidate.features.matchup)
          : "";
      const kickoff = kickoffByMatchup.get(matchup);
      if (!kickoff || candidate.predictedAt.getTime() >= kickoff.getTime()) {
        continue;
      }

      if (!latestByMarket.has(candidate.normalizedMarketId)) {
        latestByMarket.set(candidate.normalizedMarketId, candidate);
      }
    }

    const distinct = new Map<
      string,
      (typeof candidates)[number]
    >();
    for (const candidate of [...latestByMarket.values()].toSorted((a, b) => {
      const scoreDiff =
        (publicScore(b.features) ?? -Infinity) -
        (publicScore(a.features) ?? -Infinity);
      return scoreDiff || b.edgeBps - a.edgeBps;
    })) {
      const subject =
        typeof candidate.features.subject === "string"
          ? candidate.features.subject
          : "";
      const matchup =
        typeof candidate.features.matchup === "string"
          ? matchupKey(candidate.features.matchup)
          : candidate.eventTitle;
      const perspective = recommendedPredictionPerspective(candidate);
      const distinctKey = [
        matchup,
        candidate.family,
        subject,
        perspective.side,
      ].join(":");
      if (!distinct.has(distinctKey)) {
        distinct.set(distinctKey, candidate);
      }
    }

    const top = [...distinct.values()].slice(0, 10);
    if (top.length < 10) continue;

    await db
      .insert(weeklyScorecardPicks)
      .values(
        top.map((candidate, index) => ({
          id: `${season}-week-${week}-rank-${index + 1}`,
          season,
          week,
          rank: index + 1,
          predictionId: candidate.id,
          lockedAt: lockAt,
        })),
      )
      .onConflictDoNothing();

    lockedKeys.add(key);
  }
}

export async function getWeeklyScorecards(): Promise<WeeklyScorecard[]> {
  try {
    const db = getDb();
    await lockEligibleScorecards();

    const rows = await db
      .select({
        rank: weeklyScorecardPicks.rank,
        season: weeklyScorecardPicks.season,
        week: weeklyScorecardPicks.week,
        lockedAt: weeklyScorecardPicks.lockedAt,
        id: predictions.id,
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
      })
      .from(weeklyScorecardPicks)
      .innerJoin(
        predictions,
        eq(predictions.id, weeklyScorecardPicks.predictionId),
      )
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
      .orderBy(
        desc(weeklyScorecardPicks.season),
        desc(weeklyScorecardPicks.week),
        asc(weeklyScorecardPicks.rank),
      );

    const grouped = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = `${row.season}-week-${row.week}`;
      const group = grouped.get(key) ?? [];
      group.push(row);
      grouped.set(key, group);
    }

    return [...grouped.entries()]
      .map(([key, picksRows]) => {
        const first = picksRows[0]!;
        const picks: ScorecardPick[] = picksRows.map((row) => {
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
            rank: row.rank,
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
            score: publicScore(row.features) ?? row.opportunityScore,
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
          key,
          label: `NFL Week ${first.week}`,
          season: first.season,
          week: first.week,
          picks,
          settled,
          hits,
          misses: picks.filter((pick) => pick.result === "miss").length,
          profitOnTen,
          roi: settled ? profitOnTen / (settled * 10) : 0,
        };
      })
      .slice(0, 12);
  } catch (error) {
    console.error("Weekly scorecards unavailable", error);
    return [];
  }
}
