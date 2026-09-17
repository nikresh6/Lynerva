import { clamp } from "@/lib/utils";

export function chronologicalSplit<T extends { occurredAt: Date }>(
  rows: T[],
  trainFraction = 0.8,
) {
  const ordered = rows.toSorted(
    (first, second) => first.occurredAt.getTime() - second.occurredAt.getTime(),
  );
  const splitAt = Math.max(
    1,
    Math.min(ordered.length - 1, Math.floor(ordered.length * trainFraction)),
  );
  return { train: ordered.slice(0, splitAt), test: ordered.slice(splitAt) };
}

export function brierScore(
  predictions: Array<{ probability: number; outcome: 0 | 1 }>,
) {
  if (!predictions.length) return null;
  return predictions.reduce(
    (sum, item) => sum + (item.probability - item.outcome) ** 2,
    0,
  ) / predictions.length;
}

export function logLoss(
  predictions: Array<{ probability: number; outcome: 0 | 1 }>,
) {
  if (!predictions.length) return null;
  return -predictions.reduce((sum, item) => {
    const probability = clamp(item.probability, 1e-6, 1 - 1e-6);
    return sum + item.outcome * Math.log(probability) +
      (1 - item.outcome) * Math.log(1 - probability);
  }, 0) / predictions.length;
}

export function scorePredictionResult(probabilityBps: number, outcome: 0 | 1) {
  const probability = clamp(probabilityBps / 10_000, 1e-6, 1 - 1e-6);
  return {
    brierContribution: (probability - outcome) ** 2,
    logLossContribution:
      -(outcome * Math.log(probability) +
        (1 - outcome) * Math.log(1 - probability)),
  };
}
