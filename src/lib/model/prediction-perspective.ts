export type PredictionSide = "yes" | "no";

type FeatureBag = Record<string, number | string | boolean | null>;

export function recommendedPredictionPerspective(input: {
  predictedProbabilityBps: number;
  executablePriceBps: number;
  edgeBps: number;
  features: FeatureBag;
}) {
  const explicitSide = input.features.recommendedSide;
  const side: PredictionSide | null =
    explicitSide === "yes" || explicitSide === "no" ? explicitSide : null;
  const explicitProbability = input.features.recommendedProbabilityBps;

  if (
    side &&
    input.features.probabilityPerspective === "recommended_side"
  ) {
    return {
      side,
      probabilityBps:
        typeof explicitProbability === "number"
          ? explicitProbability
          : input.predictedProbabilityBps,
    };
  }

  // Rows saved before the side-aware format stored the YES probability even
  // when the recommended trade was NO. Recover the original side by comparing
  // each possible edge with the edge that was frozen on the prediction row.
  const modelYesProbability =
    typeof input.features.modelYesProbabilityBps === "number"
      ? input.features.modelYesProbabilityBps
      : input.predictedProbabilityBps;
  const yesEdge = modelYesProbability - input.executablePriceBps;
  const noProbability = 10_000 - modelYesProbability;
  const noEdge = noProbability - input.executablePriceBps;
  const inferredSide: PredictionSide =
    Math.abs(noEdge - input.edgeBps) < Math.abs(yesEdge - input.edgeBps)
      ? "no"
      : "yes";

  return {
    side: side ?? inferredSide,
    probabilityBps:
      side === "no" || (!side && inferredSide === "no")
        ? noProbability
        : modelYesProbability,
  };
}
