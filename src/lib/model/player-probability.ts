function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function empiricalPlayerProbability(input: {
  historicalHitRate: number;
  recentHitRate: number;
  recentPerformanceRatio: number;
  sampleSize: number;
}) {
  const sampleSize = Math.max(1, input.sampleSize);
  const observedHits = clamp(input.historicalHitRate, 0, 1) * sampleSize;
  const longRunPosterior = (observedHits + 1) / (sampleSize + 2);
  const recentWeight = Math.min(0.25, 5 / Math.max(sampleSize, 5));
  const blended =
    longRunPosterior * (1 - recentWeight) +
    clamp(input.recentHitRate, 0, 1) * recentWeight;
  const performanceAdjustment =
    clamp(input.recentPerformanceRatio - 1, -0.75, 0.75) * 0.08;

  return clamp(blended + performanceAdjustment, 0.02, 0.98);
}
