import "server-only";

import { and, desc, eq, isNull, lt } from "drizzle-orm";
import { getDb } from "@/db";
import {
  marketListings,
  predictionResults,
  predictions,
} from "@/db/schema";
import { fetchKalshiMarketSettlement } from "@/lib/kalshi";
import { scorePredictionResult } from "./evaluation";
import { recommendedPredictionPerspective } from "./prediction-perspective";

export async function recordPredictionResult(input: {
  predictionId: string;
  outcome: 0 | 1;
  settledAt: Date;
  settlementSource: string;
}) {
  const db = getDb();
  const [prediction] = await db
    .select({
      predictedProbabilityBps: predictions.predictedProbabilityBps,
      executablePriceBps: predictions.executablePriceBps,
      edgeBps: predictions.edgeBps,
      features: predictions.features,
    })
    .from(predictions)
    .where(eq(predictions.id, input.predictionId))
    .limit(1);
  if (!prediction) throw new Error("Prediction not found");
  const perspective = recommendedPredictionPerspective(prediction);
  const scores = scorePredictionResult(
    perspective.probabilityBps,
    input.outcome,
  );
  // Results are append-once. A later call cannot rewrite history after the
  // outcome becomes known.
  await db
    .insert(predictionResults)
    .values({
      predictionId: input.predictionId,
      outcome: input.outcome,
      settledAt: input.settledAt,
      settlementSource: input.settlementSource,
      ...scores,
    })
    .onConflictDoNothing({ target: predictionResults.predictionId });
  return scores;
}

export async function settleKalshiPredictions() {
  const db = getDb();
  const now = new Date();
  const candidates = await db
    .select({
      id: predictions.id,
      normalizedMarketId: predictions.normalizedMarketId,
      predictedProbabilityBps: predictions.predictedProbabilityBps,
      executablePriceBps: predictions.executablePriceBps,
      edgeBps: predictions.edgeBps,
      features: predictions.features,
      predictedAt: predictions.predictedAt,
      ticker: marketListings.platformMarketId,
    })
    .from(predictions)
    .innerJoin(marketListings, eq(marketListings.id, predictions.listingId))
    .leftJoin(
      predictionResults,
      eq(predictionResults.predictionId, predictions.id),
    )
    .where(
      and(
        eq(marketListings.platform, "kalshi"),
        isNull(predictionResults.predictionId),
        lt(marketListings.closesAt, now),
      ),
    )
    .orderBy(desc(predictions.predictedAt))
    .limit(1_500);

  const latestByMarket = new Map<string, (typeof candidates)[number]>();
  for (const candidate of candidates) {
    if (candidate.features.live === true) continue;
    if (!latestByMarket.has(candidate.normalizedMarketId)) {
      latestByMarket.set(candidate.normalizedMarketId, candidate);
    }
  }

  const selected = [...latestByMarket.values()].slice(0, 60);
  const uniqueTickers = [...new Set(selected.map((row) => row.ticker))];
  const settlements = await Promise.allSettled(
    uniqueTickers.map((ticker) => fetchKalshiMarketSettlement(ticker)),
  );
  const byTicker = new Map<
    string,
    Awaited<ReturnType<typeof fetchKalshiMarketSettlement>>
  >();
  settlements.forEach((settlement, index) => {
    if (settlement.status === "fulfilled" && settlement.value) {
      byTicker.set(uniqueTickers[index]!, settlement.value);
    }
  });

  let graded = 0;
  for (const candidate of selected) {
    const settlement = byTicker.get(candidate.ticker);
    if (!settlement) continue;
    const perspective = recommendedPredictionPerspective(candidate);
    const hit = perspective.side === settlement.result ? 1 : 0;
    await recordPredictionResult({
      predictionId: candidate.id,
      outcome: hit,
      settledAt: settlement.settledAt,
      settlementSource: "kalshi_market_result",
    });
    await db
      .update(marketListings)
      .set({ status: "settled" })
      .where(eq(marketListings.platformMarketId, candidate.ticker));
    graded += 1;
  }

  return {
    checked: selected.length,
    settledMarkets: byTicker.size,
    graded,
  };
}
