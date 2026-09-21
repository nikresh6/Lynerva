import type { Direction, MarketFamily } from "@/lib/markets/types";
import { poissonAtLeastProbability } from "./player-probability";

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function erf(value: number) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y =
    1 -
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) *
      Math.exp(-x * x);
  return sign * y;
}

function normalCdf(value: number, mean: number, stdDev: number) {
  return 0.5 * (1 + erf((value - mean) / (stdDev * Math.sqrt(2))));
}

const poissonFamilies = new Set<MarketFamily>([
  "passing_touchdowns",
  "passing_interceptions",
  "rushing_touchdowns",
  "receiving_touchdowns",
  "touchdowns",
]);

export interface LivePlayerConditionalEstimate {
  probability: number;
  projectedFinal: number;
  expectedRemaining: number;
  remainingStdDev: number | null;
}

export function conditionalLivePlayerProbability(input: {
  family: MarketFamily;
  direction: Direction;
  threshold: number;
  currentValue: number;
  baselineFullGameProjection: number;
  fullGameStdDev: number;
  remainingFraction: number;
}): LivePlayerConditionalEstimate | null {
  const remaining = clamp(input.remainingFraction, 0.001, 1);
  const current = Math.max(0, input.currentValue);
  const baseline = Math.max(0, input.baselineFullGameProjection);

  if (input.family === "longest_reception") {
    if (current >= input.threshold) {
      const overProbability = 0.999;
      return {
        probability:
          input.direction === "under" ? 1 - overProbability : overProbability,
        projectedFinal: current,
        expectedRemaining: 0,
        remainingStdDev: null,
      };
    }

    const fullGameOver =
      1 -
      normalCdf(
        input.threshold,
        baseline,
        Math.max(1, input.fullGameStdDev),
      );
    const remainingOver =
      1 - Math.pow(1 - clamp(fullGameOver, 0.001, 0.999), remaining);
    return {
      probability:
        input.direction === "under" ? 1 - remainingOver : remainingOver,
      projectedFinal: Math.max(current, baseline),
      expectedRemaining: 0,
      remainingStdDev: null,
    };
  }

  const expectedRemaining = baseline * remaining;
  const projectedFinal = current + expectedRemaining;
  let overProbability: number;

  if (poissonFamilies.has(input.family)) {
    const target = Math.ceil(input.threshold);
    const additionalNeeded = Math.max(0, target - current);
    overProbability =
      additionalNeeded <= 0
        ? 0.999
        : poissonAtLeastProbability(additionalNeeded, expectedRemaining);
  } else {
    const boundary =
      input.family === "receptions" && Number.isInteger(input.threshold)
        ? input.threshold - 0.5
        : input.threshold;
    const remainingStdDev = Math.max(
      input.family === "receptions" ? 0.75 : 1,
      input.fullGameStdDev * Math.sqrt(remaining),
    );
    overProbability =
      1 - normalCdf(boundary, projectedFinal, remainingStdDev);

    return {
      probability: clamp(
        input.direction === "under" ? 1 - overProbability : overProbability,
        0.001,
        0.999,
      ),
      projectedFinal,
      expectedRemaining,
      remainingStdDev,
    };
  }

  return {
    probability: clamp(
      input.direction === "under" ? 1 - overProbability : overProbability,
      0.001,
      0.999,
    ),
    projectedFinal,
    expectedRemaining,
    remainingStdDev: null,
  };
}
