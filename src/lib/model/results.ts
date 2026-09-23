import "server-only";

import { and, desc, eq, isNull, lt } from "drizzle-orm";
import { getDb } from "@/db";
import {
  marketListings,
  predictionResults,
  predictions,
  weeklyScorecardPicks,
} from "@/db/schema";
import { fetchKalshiMarketSettlement } from "@/lib/kalshi";
import { scorePredictionResult } from "./evaluation";
import { recommendedPredictionPerspective } from "./prediction-perspective";

const LOCKED_SETTLEMENT_RECHECK_MS = 60_000;
let lockedSettlementLastCheckedAt = 0;
let lockedSettlementInflight: Promise<{
  checked: number;
  settledMarkets: number;
  graded: number;
}> | null = null;

async function fetchSettlements(tickers: string[]) {
  const byTicker = new Map<
    string,
    Awaited<ReturnType<typeof fetchKalshiMarketSettlement>>
  >();

  // Kalshi has already rate-limited bursty NFL-series traffic in production.
  // Settlement checks are intentionally small and paced so stale scorecards do
  // not create a second request burst.
  for (let index = 0; index < tickers.length; index += 3) {
    const batch = tickers.slice(index, index + 3);
    const settlements = await Promise.allSettled(
      batch.map((ticker) => fetchKalshiMarketSettlement(ticker)),
    );
    settlements.forEach((settlement, batchIndex) => {
      if (settlement.status === "fulfilled" && settlement.value) {
        byTicker.set(batch[batchIndex]!, settlement.value);
      }
    });
    if (index + 3 < tickers.length) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  return byTicker;
}

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

export async function settleLockedScorecardPredictions(options?: {
  force?: boolean;
}) {
  const nowMs = Date.now();
  if (
    !options?.force &&
    nowMs - lockedSettlementLastCheckedAt < LOCKED_SETTLEMENT_RECHECK_MS
  ) {
    return { checked: 0, settledMarkets: 0, graded: 0 };
  }
  if (lockedSettlementInflight) return lockedSettlementInflight;

  lockedSettlementInflight = (async () => {
    const db = getDb();
    const lockedCandidates = await db
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
      .from(weeklyScorecardPicks)
      .innerJoin(
        predictions,
        eq(predictions.id, weeklyScorecardPicks.predictionId),
      )
      .innerJoin(
        marketListings,
        eq(marketListings.id, predictions.listingId),
      )
      .leftJoin(
        predictionResults,
        eq(predictionResults.predictionId, predictions.id),
      )
      .where(
        and(
          eq(marketListings.platform, "kalshi"),
          isNull(predictionResults.predictionId),
        ),
      )
      .limit(50);

    const uniqueTickers = [...new Set(lockedCandidates.map((row) => row.ticker))];
    const byTicker = await fetchSettlements(uniqueTickers);

    let graded = 0;
    for (const candidate of lockedCandidates) {
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

    lockedSettlementLastCheckedAt = Date.now();
    return {
      checked: lockedCandidates.length,
      settledMarkets: byTicker.size,
      graded,
    };
  })();

  try {
    return await lockedSettlementInflight;
  } finally {
    lockedSettlementInflight = null;
  }
}

export async function settleKalshiPredictions() {
  const db = getDb();
  const now = new Date();

  // Settle permanent scorecard picks first so the broader prediction scan
  // cannot re-query the same locked prediction in the same cycle.
  const lockedSettlement = await settleLockedScorecardPredictions({ force: true });

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

  const selectedById = new Map<
    string,
    (typeof candidates)[number]
  >();
  for (const candidate of [...latestByMarket.values()].slice(0, 60)) {
    if (!selectedById.has(candidate.id)) {
      selectedById.set(candidate.id, candidate);
    }
  }
  const selected = [...selectedById.values()];
  const uniqueTickers = [...new Set(selected.map((row) => row.ticker))];
  const byTicker = await fetchSettlements(uniqueTickers);

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
    checked: lockedSettlement.checked + selected.length,
    settledMarkets: lockedSettlement.settledMarkets + byTicker.size,
    graded: lockedSettlement.graded + graded,
  };
}
