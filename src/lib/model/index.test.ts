import { describe, expect, it } from "vitest";
import { brierScore, chronologicalSplit, logLoss, scorePredictionResult } from "./evaluation";

describe("model evaluation", () => {
  it("uses chronological splits so future games cannot leak into training", () => {
    const rows = [3, 1, 4, 2, 5].map((day) => ({ day, occurredAt: new Date(`2026-09-0${day}T00:00:00Z`) }));
    const { train, test } = chronologicalSplit(rows, 0.6);
    expect(train.map((row) => row.day)).toEqual([1, 2, 3]);
    expect(test.map((row) => row.day)).toEqual([4, 5]);
    expect(Math.max(...train.map((row) => row.occurredAt.getTime()))).toBeLessThan(Math.min(...test.map((row) => row.occurredAt.getTime())));
  });

  it("penalizes confident wrong predictions more strongly", () => {
    const moderateWrong = [{ probability: 0.51, outcome: 0 as const }];
    const confidentWrong = [{ probability: 0.95, outcome: 0 as const }];
    expect(brierScore(confidentWrong) ?? 0).toBeGreaterThan(brierScore(moderateWrong) ?? 0);
    expect(logLoss(confidentWrong) ?? 0).toBeGreaterThan(logLoss(moderateWrong) ?? 0);
  });

  it("scores an immutable prediction result from the pre-resolution probability", () => {
    expect(scorePredictionResult(7_000, 1)).toEqual({
      brierContribution: expect.closeTo(0.09, 8),
      logLossContribution: expect.closeTo(-Math.log(0.7), 8),
    });
  });
});
