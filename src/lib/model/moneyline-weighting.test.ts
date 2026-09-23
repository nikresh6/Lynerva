import { describe, expect, it } from "vitest";
import {
  calculateMoneylineWeights,
  MONEYLINE_SOURCES,
  MONEYLINE_WEIGHT_BOUNDS,
  MONEYLINE_WEIGHT_PRIORS,
  type MoneylineWeightSample,
} from "./moneyline-weighting";

function samples(count: number, week = 2): MoneylineWeightSample[] {
  return Array.from({ length: count }, (_, index) => {
    const outcome = index % 2 === 0 ? (1 as const) : (0 as const);
    return MONEYLINE_SOURCES.map((source) => ({
      source,
      outcome,
      week,
      probability:
        source === "nflverse_current_season_scoring"
          ? outcome === 1
            ? 0.8
            : 0.2
          : source === "nflverse_current_season_record"
            ? outcome === 1
              ? 0.6
              : 0.4
            : outcome === 1
              ? 0.35
              : 0.65,
    }));
  }).flat();
}

describe("learned moneyline source weights", () => {
  it("I/J: rewards better Brier performance and reduces poor performance", () => {
    const result = calculateMoneylineWeights(samples(200), 4);
    const bySource = new Map(result.map((row) => [row.source, row]));
    expect(
      bySource.get("nflverse_current_season_scoring")!.weight,
    ).toBeGreaterThan(MONEYLINE_WEIGHT_PRIORS.nflverse_current_season_scoring);
    expect(bySource.get("espn_fpi")!.weight).toBeLessThan(
      MONEYLINE_WEIGHT_PRIORS.espn_fpi,
    );
  });

  it("K: keeps tiny samples at the starting priors", () => {
    const result = calculateMoneylineWeights(samples(10), 4);
    for (const row of result) {
      expect(row.weight).toBeCloseTo(MONEYLINE_WEIGHT_PRIORS[row.source], 10);
    }
  });

  it("L: normalizes weights and respects every lower/upper guardrail", () => {
    const result = calculateMoneylineWeights(samples(300), 4);
    expect(result.reduce((sum, row) => sum + row.weight, 0)).toBeCloseTo(1, 10);
    for (const row of result) {
      expect(row.weight).toBeGreaterThanOrEqual(
        MONEYLINE_WEIGHT_BOUNDS[row.source].min,
      );
      expect(row.weight).toBeLessThanOrEqual(
        MONEYLINE_WEIGHT_BOUNDS[row.source].max,
      );
    }
  });

  it("M: activates Week N results only for Week N+1", () => {
    const weekThree = samples(200, 3);
    const frozenWeekThree = calculateMoneylineWeights(weekThree, 3);
    const weekFour = calculateMoneylineWeights(weekThree, 4);
    expect(
      frozenWeekThree.find(
        (row) => row.source === "nflverse_current_season_scoring",
      )!.weight,
    ).toBeCloseTo(MONEYLINE_WEIGHT_PRIORS.nflverse_current_season_scoring, 10);
    expect(
      weekFour.find(
        (row) => row.source === "nflverse_current_season_scoring",
      )!.weight,
    ).toBeGreaterThan(MONEYLINE_WEIGHT_PRIORS.nflverse_current_season_scoring);
  });
});
