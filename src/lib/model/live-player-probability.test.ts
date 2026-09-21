import { describe, expect, it } from "vitest";
import {
  conditionalLivePlayerProbability,
  liveGameScriptMultiplier,
  liveInjuryAvailabilityMultiplier,
} from "./live-player-probability";

describe("conditionalLivePlayerProbability", () => {
  it("conditions a receiving-yard under on current yards and in-game pace", () => {
    const result = conditionalLivePlayerProbability({
      family: "receiving_yards",
      direction: "under",
      threshold: 150,
      currentValue: 140,
      baselineFullGameProjection: 40,
      fullGameStdDev: 29,
      remainingFraction: 0.1,
    });

    expect(result).not.toBeNull();
    expect(result!.projectedFinal).toBeGreaterThan(145);
    expect(result!.projectedFinal).toBeLessThan(152);
    expect(result!.paceAdjustedFullGameProjection).toBeGreaterThan(40);
    expect(result!.probability).toBeGreaterThan(0.45);
    expect(result!.probability).toBeLessThan(0.9);
  });

  it("makes an under nearly impossible once the threshold is already crossed", () => {
    const result = conditionalLivePlayerProbability({
      family: "receiving_yards",
      direction: "under",
      threshold: 150,
      currentValue: 155,
      baselineFullGameProjection: 65,
      fullGameStdDev: 29,
      remainingFraction: 0.2,
    });

    expect(result).not.toBeNull();
    expect(result!.probability).toBeLessThan(0.1);
  });

  it("shrinks noisy count-stat pace toward the pregame baseline", () => {
    const result = conditionalLivePlayerProbability({
      family: "passing_touchdowns",
      direction: "over",
      threshold: 2,
      currentValue: 1,
      baselineFullGameProjection: 2.4,
      fullGameStdDev: 1,
      remainingFraction: 0.25,
    });

    expect(result).not.toBeNull();
    expect(result!.expectedRemaining).toBeGreaterThan(0.45);
    expect(result!.expectedRemaining).toBeLessThan(0.65);
    expect(result!.paceWeight).toBeLessThan(0.3);
  });

  it("cuts remaining production to zero when a player is ruled out", () => {
    const result = conditionalLivePlayerProbability({
      family: "receiving_yards",
      direction: "over",
      threshold: 100,
      currentValue: 82,
      baselineFullGameProjection: 90,
      fullGameStdDev: 29,
      remainingFraction: 0.35,
      remainingRateMultiplier: 0,
    });

    expect(result).not.toBeNull();
    expect(result!.expectedRemaining).toBe(0);
    expect(result!.projectedFinal).toBe(82);
    expect(result!.probability).toBeLessThan(0.05);
  });
});

describe("live context multipliers", () => {
  it("treats a confirmed out designation differently from generic questionable", () => {
    expect(
      liveInjuryAvailabilityMultiplier("Out", "Ruled out for the game"),
    ).toBe(0);
    expect(
      liveInjuryAvailabilityMultiplier("Questionable", "Questionable"),
    ).toBe(1);
    expect(
      liveInjuryAvailabilityMultiplier(
        "Questionable",
        "Questionable to return with an ankle injury",
      ),
    ).toBe(0.45);
  });

  it("uses score margin to shift passing and rushing opportunity", () => {
    expect(liveGameScriptMultiplier("passing_yards", -14)).toBeGreaterThan(1);
    expect(liveGameScriptMultiplier("rushing_yards", -14)).toBeLessThan(1);
    expect(liveGameScriptMultiplier("rushing_yards", 14)).toBeGreaterThan(1);
  });
});
