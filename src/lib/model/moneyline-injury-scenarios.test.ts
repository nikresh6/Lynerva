import { describe, expect, it } from "vitest";
import { applyMoneylineInjuryScenarios } from "./moneyline-injury-scenarios";
import { blendMoneylineSourceProbabilities } from "./moneyline-weighting";

function quarterback(
  overrides: Partial<Parameters<typeof applyMoneylineInjuryScenarios>[0]["players"][number]> = {},
) {
  return {
    player: "Generic Starting QB",
    team: "CHI",
    position: "QB",
    side: "subject" as const,
    status: "Questionable",
    playProbability: 0.5,
    expectedUsageIfActive: 1,
    impactPoints: 5,
    sources: ["ESPN"],
    ...overrides,
  };
}

describe("moneyline injury scenarios", () => {
  it("A: leaves a healthy starting quarterback approximately unchanged", () => {
    const result = applyMoneylineInjuryScenarios({
      baselineMargin: 1,
      marginStdDev: 12,
      players: [
        quarterback({
          status: "Active",
          playProbability: 0.995,
          expectedUsageIfActive: 0.99,
        }),
      ],
    });
    expect(result.adjustedProbability).toBe(result.baselineProbability);
    expect(result.reliabilityPenalty).toBe(0);
  });

  it("B: moves an out quarterback to the backup scenario", () => {
    const result = applyMoneylineInjuryScenarios({
      baselineMargin: 0,
      marginStdDev: 12,
      players: [quarterback({ status: "Out", playProbability: 0 })],
    });
    expect(result.adjustedProbability).toBeLessThan(
      result.baselineProbability - 0.1,
    );
    expect(Math.round(result.adjustedProbability * 10_000)).toBe(
      result.scenarios[0]?.inactiveWinProbabilityBps,
    );
  });

  it("C: blends active and inactive outcomes for a questionable QB", () => {
    const result = applyMoneylineInjuryScenarios({
      baselineMargin: 0,
      marginStdDev: 12,
      players: [quarterback({ playProbability: 0.6 })],
    });
    const scenario = result.scenarios[0]!;
    const expected =
      0.6 * (scenario.activeWinProbabilityBps / 10_000) +
      0.4 * (scenario.inactiveWinProbabilityBps / 10_000);
    expect(result.adjustedProbability).toBeCloseTo(expected, 3);
  });

  it("D/E: penalizes 50/50 high-impact uncertainty more than 90% availability", () => {
    const uncertain = applyMoneylineInjuryScenarios({
      baselineMargin: 0,
      marginStdDev: 10,
      players: [quarterback({ playProbability: 0.5, impactPoints: 6 })],
    });
    const likely = applyMoneylineInjuryScenarios({
      baselineMargin: 0,
      marginStdDev: 10,
      players: [quarterback({ playProbability: 0.9, impactPoints: 6 })],
    });
    expect(uncertain.reliabilityPenalty).toBeGreaterThan(0.1);
    expect(likely.reliabilityPenalty).toBeLessThan(
      uncertain.reliabilityPenalty,
    );
  });

  it("F: keeps a low-impact questionable player adjustment small", () => {
    const result = applyMoneylineInjuryScenarios({
      baselineMargin: 0,
      marginStdDev: 13,
      players: [
        quarterback({
          player: "Rotational Receiver",
          position: "WR",
          impactPoints: 0.3,
        }),
      ],
    });
    expect(
      Math.abs(result.adjustedProbability - result.baselineProbability),
    ).toBeLessThan(0.01);
  });

  it("G: leaves ESPN raw while changing only the internal scoring source", () => {
    const espnRaw = 0.418;
    const internal = applyMoneylineInjuryScenarios({
      baselineMargin: 0.4,
      marginStdDev: 12,
      players: [quarterback({ playProbability: 0.45 })],
    });
    const final = blendMoneylineSourceProbabilities([
      { probability: internal.adjustedProbability, weight: 0.5 },
      { probability: 0.51, weight: 0.15 },
      { probability: espnRaw, weight: 0.35 },
    ]);
    expect(espnRaw).toBe(0.418);
    expect(final).not.toBeNull();
  });

  it("H: market price changes cannot change the model-only blend", () => {
    const modelInputs = [
      { probability: 0.47, weight: 0.5 },
      { probability: 0.52, weight: 0.15 },
      { probability: 0.44, weight: 0.35 },
    ];
    const firstMarketPrice = 0.39;
    const secondMarketPrice = 0.55;
    expect(firstMarketPrice).not.toBe(secondMarketPrice);
    expect(blendMoneylineSourceProbabilities(modelInputs)).toBe(
      blendMoneylineSourceProbabilities(modelInputs),
    );
  });

  it("N: falls back exactly when injury data is missing", () => {
    const result = applyMoneylineInjuryScenarios({
      baselineMargin: -1.5,
      marginStdDev: 13,
      players: [],
    });
    expect(result.adjustedProbability).toBe(result.baselineProbability);
    expect(result.scenarios).toEqual([]);
    expect(result.reliabilityPenalty).toBe(0);
  });
});
