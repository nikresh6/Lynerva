import { describe, expect, it } from "vitest";
import {
  conditionalLivePlayerProbability,
  liveBlowoutSubstitutionMultiplier,
  liveClockManagementMultiplier,
  liveExpectedOvertimeFraction,
  liveGameScriptMultiplier,
  liveInjuryAvailabilityMultiplier,
  livePossessionOpportunityMultiplier,
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

  it("does not become falsely certain on a late passing-yard under while a drive is still possible", () => {
    const result = conditionalLivePlayerProbability({
      family: "passing_yards",
      direction: "under",
      threshold: 300,
      currentValue: 271,
      baselineFullGameProjection: 280,
      fullGameStdDev: 58,
      remainingFraction: 0.03,
      remainingRateMultiplier: 1.3,
    });

    expect(result).not.toBeNull();
    expect(result!.projectedFinal).toBeGreaterThan(280);
    expect(result!.remainingStdDev).not.toBeNull();
    expect(result!.remainingStdDev!).toBeGreaterThan(15);
    expect(result!.probability).toBeGreaterThan(0.6);
    expect(result!.probability).toBeLessThan(0.95);
  });

  it("keeps a tied late passing prop open to overtime opportunity", () => {
    const regulationOnly = conditionalLivePlayerProbability({
      family: "passing_yards",
      direction: "under",
      threshold: 300,
      currentValue: 271,
      baselineFullGameProjection: 280,
      fullGameStdDev: 58,
      remainingFraction: 0.03,
    });
    const withOvertime = conditionalLivePlayerProbability({
      family: "passing_yards",
      direction: "under",
      threshold: 300,
      currentValue: 271,
      baselineFullGameProjection: 280,
      fullGameStdDev: 58,
      remainingFraction: 0.03,
      opportunityRemainingFraction: 0.08,
    });

    expect(regulationOnly).not.toBeNull();
    expect(withOvertime).not.toBeNull();
    expect(withOvertime!.expectedRemaining).toBeGreaterThan(
      regulationOnly!.expectedRemaining,
    );
    expect(withOvertime!.probability).toBeLessThan(regulationOnly!.probability);
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

  it("uses late possession to change remaining opportunity without overreacting early", () => {
    expect(livePossessionOpportunityMultiplier(0.5, "KC", "KC")).toBe(1);
    expect(livePossessionOpportunityMultiplier(0.03, "KC", "KC")).toBeGreaterThan(1.25);
    expect(livePossessionOpportunityMultiplier(0.03, "KC", "IND")).toBeLessThan(0.8);
  });

  it("cuts passing volume for a leading offense that can drain the clock", () => {
    const passing = liveClockManagementMultiplier(
      "passing_yards",
      10,
      0.08,
      true,
      0,
    );
    const rushing = liveClockManagementMultiplier(
      "rushing_yards",
      10,
      0.08,
      true,
      0,
    );
    expect(passing).toBeLessThan(0.75);
    expect(rushing).toBeGreaterThan(1.1);
  });

  it("boosts hurry-up passing and suppresses rushing for a trailing offense", () => {
    expect(
      liveClockManagementMultiplier("passing_yards", -10, 0.08, true, 2),
    ).toBeGreaterThan(1.15);
    expect(
      liveClockManagementMultiplier("rushing_yards", -10, 0.08, true, 2),
    ).toBeLessThan(0.9);
  });

  it("prices starter rotation risk in a late blowout without applying it early", () => {
    expect(
      liveBlowoutSubstitutionMultiplier("passing_yards", 28, 0.1, 275),
    ).toBeLessThan(0.7);
    expect(
      liveBlowoutSubstitutionMultiplier("passing_yards", 28, 0.6, 275),
    ).toBe(1);
    expect(
      liveBlowoutSubstitutionMultiplier("receiving_yards", 28, 0.1, 18),
    ).toBeGreaterThan(0.8);
  });

  it("adds expected overtime opportunity when a game is tied late", () => {
    expect(liveExpectedOvertimeFraction(0, 0.03)).toBeGreaterThan(0.04);
    expect(liveExpectedOvertimeFraction(10, 0.03)).toBe(0);
    expect(liveExpectedOvertimeFraction(0, 0.5)).toBe(0);
  });

  it("uses score margin to shift passing and rushing opportunity", () => {
    expect(liveGameScriptMultiplier("passing_yards", -14)).toBeGreaterThan(1);
    expect(liveGameScriptMultiplier("rushing_yards", -14)).toBeLessThan(1);
    expect(liveGameScriptMultiplier("rushing_yards", 14)).toBeGreaterThan(1);
  });
});
