import "server-only";

import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  normalizedMarkets,
  predictionResults,
  predictions,
} from "@/db/schema";
import { clamp } from "@/lib/utils";
import type { CanonicalMarket } from "@/lib/markets/types";

type CalibrationBucket = { count: number; wins: number };
type CalibrationTable = {
  global: CalibrationBucket[];
  byFamily: Map<string, CalibrationBucket[]>;
};

let cache: { at: number; table: CalibrationTable } | null = null;
let inflight: Promise<CalibrationTable> | null = null;

function emptyBuckets() {
  return Array.from({ length: 10 }, () => ({ count: 0, wins: 0 }));
}

function record(
  buckets: CalibrationBucket[],
  probabilityBps: number,
  outcome: number,
) {
  const bucket = Math.min(
    9,
    Math.max(0, Math.floor(probabilityBps / 1_000)),
  );
  buckets[bucket]!.count += 1;
  buckets[bucket]!.wins += outcome;
}

async function queryTable(): Promise<CalibrationTable> {
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
      .limit(2_000);

    const global = emptyBuckets();
    const byFamily = new Map<string, CalibrationBucket[]>();

    for (const row of rows) {
      record(global, row.probability, row.outcome);
      const familyBuckets =
        byFamily.get(row.family) ?? emptyBuckets();
      record(familyBuckets, row.probability, row.outcome);
      byFamily.set(row.family, familyBuckets);
    }

    const table = { global, byFamily };
    cache = { at: Date.now(), table };
    return table;
  } catch {
    return { global: emptyBuckets(), byFamily: new Map() };
  }
}

async function loadTable() {
  if (cache && Date.now() - cache.at < 15 * 60_000) return cache.table;
  if (inflight) return inflight;

  inflight = queryTable();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

export async function selfCalibrateProbability(
  probability: number,
  family?: CanonicalMarket["family"],
) {
  const table = await loadTable();
  const bucket = Math.min(9, Math.max(0, Math.floor(probability * 10)));
  const familyEvidence = family
    ? table.byFamily.get(family)?.[bucket] ?? null
    : null;
  const globalEvidence = table.global[bucket]!;

  // Prefer calibration learned within the same stat family. A 70% rushing-yard
  // prediction should not be corrected using a bucket dominated by TD props or
  // game totals. Fall back to the global bucket only while a family has too
  // little settled evidence.
  const evidence =
    familyEvidence && familyEvidence.count >= 20
      ? familyEvidence
      : globalEvidence;

  if (evidence.count < 20) {
    return {
      probability,
      sampleSize: evidence.count,
      learned: false,
      familySpecific: false,
    };
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
    familySpecific: Boolean(
      familyEvidence && familyEvidence.count >= 20,
    ),
  };
}
