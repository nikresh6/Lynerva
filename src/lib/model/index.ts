import "server-only";

import { desc, eq, like } from "drizzle-orm";
import { getDb } from "@/db";
import { nflPlayers, playerGameStats } from "@/db/schema";
import { clamp } from "@/lib/utils";
import type {
  CanonicalMarket,
  HistoricalEvidence,
  ModelEstimate,
} from "@/lib/markets/types";

const MODEL_VERSION = "baseline-logit-v1";

const emptyEvidence: HistoricalEvidence = {
  last5Hits: null,
  last10Hits: null,
  seasonHits: null,
  seasonGames: null,
  sampleSize: 0,
};

function statisticValue(
  row: typeof playerGameStats.$inferSelect,
  statistic: string | null,
) {
  if (!statistic) return null;
  const mapping: Record<string, number | null> = {
    passing_yards: row.passingYards,
    passing_touchdowns: row.passingTouchdowns,
    rushing_yards: row.rushingYards,
    receiving_yards: row.receivingYards,
    receptions: row.receptions,
    touchdowns:
      (row.passingTouchdowns ?? 0) +
      (row.rushingTouchdowns ?? 0) +
      (row.receivingTouchdowns ?? 0),
  };
  return mapping[statistic] ?? null;
}

function isHit(value: number, threshold: number, direction: string) {
  return direction === "under" ? value < threshold : value >= threshold;
}

export function calibratedLogisticProbability(input: {
  seasonHitRate: number;
  recentHitRate: number;
  recentPerformanceRatio: number;
  sampleSize: number;
}) {
  const linear =
    -1.18 +
    1.25 * input.seasonHitRate +
    0.95 * input.recentHitRate +
    0.42 * clamp(input.recentPerformanceRatio - 1, -1, 1) +
    0.018 * Math.min(input.sampleSize, 17);
  return 1 / (1 + Math.exp(-linear));
}

function hits(values: number[], threshold: number, direction: string) {
  return values.reduce(
    (count, value) => count + (isHit(value, threshold, direction) ? 1 : 0),
    0,
  );
}

export async function estimateMarket(
  canonical: CanonicalMarket | null,
): Promise<ModelEstimate> {
  if (
    !canonical ||
    canonical.threshold === null ||
    canonical.statistic === null ||
    ["moneyline", "spread", "game_total"].includes(canonical.family)
  ) {
    return {
      probabilityBps: null,
      reliabilityBps: 0,
      version: MODEL_VERSION,
      evidence: emptyEvidence,
      factors: ["A model estimate is not available until comparable historical data is linked."],
    };
  }

  try {
    const db = getDb();
    const playerName = canonical.subject.replace(/\b(nfl|will)\b/gi, "").trim();
    const [player] = await db
      .select({ id: nflPlayers.id, name: nflPlayers.fullName })
      .from(nflPlayers)
      .where(like(nflPlayers.fullName, `%${playerName}%`))
      .limit(1);
    if (!player) {
      return {
        probabilityBps: null,
        reliabilityBps: 0,
        version: MODEL_VERSION,
        evidence: emptyEvidence,
        factors: ["No verified historical player record matches this contract yet."],
      };
    }
    const rows = await db
      .select()
      .from(playerGameStats)
      .where(eq(playerGameStats.playerId, player.id))
      .orderBy(desc(playerGameStats.gameId))
      .limit(20);
    const values = rows
      .map((row) => statisticValue(row, canonical.statistic))
      .filter((value): value is number => value !== null);
    if (values.length < 5) {
      return {
        probabilityBps: null,
        reliabilityBps: Math.round((values.length / 10) * 4_000),
        version: MODEL_VERSION,
        evidence: { ...emptyEvidence, sampleSize: values.length },
        factors: [`Only ${values.length} comparable games are available; at least 5 are required.`],
      };
    }

    const last5 = values.slice(0, 5);
    const last10 = values.slice(0, 10);
    const threshold = canonical.threshold;
    const seasonHitCount = hits(values, threshold, canonical.direction);
    const recentHitCount = hits(last5, threshold, canonical.direction);
    const average = last5.reduce((sum, value) => sum + value, 0) / last5.length;
    const probability = calibratedLogisticProbability({
      seasonHitRate: seasonHitCount / values.length,
      recentHitRate: recentHitCount / last5.length,
      recentPerformanceRatio: threshold === 0 ? 1 : average / threshold,
      sampleSize: values.length,
    });
    const reliability = clamp(values.length / 17, 0, 1) * 0.78;
    return {
      probabilityBps: Math.round(clamp(probability, 0.03, 0.97) * 10_000),
      reliabilityBps: Math.round(reliability * 10_000),
      version: MODEL_VERSION,
      evidence: {
        last5Hits: recentHitCount,
        last10Hits: hits(last10, threshold, canonical.direction),
        seasonHits: seasonHitCount,
        seasonGames: values.length,
        sampleSize: values.length,
      },
      factors: [
        `${player.name} cleared this threshold in ${recentHitCount} of the last 5 comparable games.`,
        `Season sample: ${seasonHitCount} of ${values.length}.`,
        `Last-5 average: ${average.toFixed(1)} against a ${threshold} threshold.`,
      ],
    };
  } catch (error) {
    console.error("Model estimate failed", error);
    return {
      probabilityBps: null,
      reliabilityBps: 0,
      version: MODEL_VERSION,
      evidence: emptyEvidence,
      factors: ["Historical evidence is temporarily unavailable."],
    };
  }
}
