import "server-only";

import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { normalizedMarkets, predictionResults, predictions } from "@/db/schema";
import { clamp } from "@/lib/utils";

type CalibrationBucket = { count: number; wins: number };
type CalibrationByFamily = Record<string, CalibrationBucket[]>;

function emptyBuckets() {
  return Array.from({ length: 10 }, () => ({ count: 0, wins: 0 }));
}

let cache: { at: number; bucketsByFamily: CalibrationByFamily } | null = null;
let inflight: Promise<CalibrationByFamily> | null = null;

async function queryBuckets() {
  try {
    const db = getDb();
    const rows = await db
      .select({
        probability: predictions.predictedProbabilityBps,
        outcome: predictionResults.outcome,
        family: normalizedMarkets.family,
      })
      .from(predictions)
      .innerJoin(
        predictionResults,
        eq(predictionResults.predictionId, predictions.id),
      )
      .innerJoin(
        normalizedMarkets,
        eq(normalizedMarkets.id, predictions.normalizedMarketId),
      )
      .orderBy(desc(predictionResults.settledAt))
      .limit(1_500);

    const bucketsByFamily: CalibrationByFamily = {};
    for (const row of rows) {
      const buckets = bucketsByFamily[row.family] ?? emptyBuckets();
      const bucket = Math.min(9, Math.max(0, Math.floor(row.probability / 1000)));
      buckets[bucket]!.count += 1;
      buckets[bucket]!.wins += row.outcome;
      bucketsByFamily[row.family] = buckets;
    }
    cache = { at: Date.now(), bucketsByFamily };
    return bucketsByFamily;
  } catch {
    return {};
  }
}

async function loadBuckets() {
  if (cache && Date.now() - cache.at < 15 * 60_000) return cache.bucketsByFamily;
  if (inflight) return inflight;

  inflight = queryBuckets();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

export async function selfCalibrateProbability(
  probability: number,
  family: string,
) {
  const bucketsByFamily = await loadBuckets();
  const buckets = bucketsByFamily[family];
  if (!buckets) {
    return { probability, sampleSize: 0, learned: false };
  }

  const bucket = Math.min(9, Math.max(0, Math.floor(probability * 10)));
  const evidence = buckets[bucket]!;
  if (evidence.count < 20) {
    return { probability, sampleSize: evidence.count, learned: false };
  }
  const empirical = evidence.wins / evidence.count;
  const learningWeight = clamp((evidence.count - 20) / 180, 0.1, 0.65);
  return {
    probability: clamp(
      probability * (1 - learningWeight) + empirical * learningWeight,
      0.001,
      0.999,
    ),
    sampleSize: evidence.count,
    learned: true,
  };
}
