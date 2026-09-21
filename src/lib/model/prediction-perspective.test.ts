import { describe, expect, it } from "vitest";
import { recommendedPredictionPerspective } from "./prediction-perspective";

describe("recommended prediction perspective", () => {
  it("uses the explicit recommended-side format", () => {
    expect(
      recommendedPredictionPerspective({
        predictedProbabilityBps: 6400,
        executablePriceBps: 5200,
        edgeBps: 1200,
        features: {
          recommendedSide: "no",
          recommendedProbabilityBps: 6400,
          probabilityPerspective: "recommended_side",
        },
      }),
    ).toEqual({ side: "no", probabilityBps: 6400 });
  });

  it("recovers a legacy NO recommendation from its saved edge", () => {
    expect(
      recommendedPredictionPerspective({
        predictedProbabilityBps: 3500,
        executablePriceBps: 5000,
        edgeBps: 1500,
        features: {},
      }),
    ).toEqual({ side: "no", probabilityBps: 6500 });
  });
});
