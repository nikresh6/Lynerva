import "server-only";

import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { predictionResults, predictions } from "@/db/schema";
import { clamp } from "@/lib/utils";

type CalibrationBucket = { count: number; wins: number };

let cache: { at: number; buckets: CalibrationBucket[] } | null = null;
let inflight: Promise<CalibrationBucket[]> | null = null;

async function queryBuckets() {
  try {
    const db = getDb();
    const rows = await db
      .select({
        probability: predictions.predictedProbabilityBps,
        outcome: predictionResults.outcome,
      })
      .from(predictions)
      .innerJoin(
        predictionResults,
        eq(predictionResults.predictionId, predictions.id),
      )
      .orderBy(desc(predictionResults.settledAt))
      .limit(750);

    const buckets = Array.from({ length: 10 }, () => ({ count: 0, wins: 0 }));
    for (const row of rows) {
      const bucket = Math.min(9, Math.max(0, Math.floor(row.probability / 1000)));
      buckets[bucket]!.count += 1;
      buckets[bucket]!.wins += row.outcome;
    }
    cache = { at: Date.now(), buckets };
    return buckets;
  } catch {
    return Array.from({ length: 10 }, () => ({ count: 0, wins: 0 }));
  }
}

async function loadBuckets() {
  if (cache && Date.now() - cache.at < 15 * 60_000) return cache.buckets;
  if (inflight) return inflight;

  inflight = queryBuckets();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

export async function selfCalibrateProbability(probability: number) {
  const buckets = await loadBuckets();
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
      0.02,
      0.98,
    ),
    sampleSize: evidence.count,
    learned: true,
  };
}
