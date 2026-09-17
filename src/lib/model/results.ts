import "server-only";

import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { predictionResults, predictions } from "@/db/schema";
import { scorePredictionResult } from "./evaluation";

export async function recordPredictionResult(input: {
  predictionId: string;
  outcome: 0 | 1;
  settledAt: Date;
  settlementSource: string;
}) {
  const db = getDb();
  const [prediction] = await db
    .select({ probability: predictions.predictedProbabilityBps })
    .from(predictions)
    .where(eq(predictions.id, input.predictionId))
    .limit(1);
  if (!prediction) throw new Error("Prediction not found");
  const scores = scorePredictionResult(prediction.probability, input.outcome);
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
