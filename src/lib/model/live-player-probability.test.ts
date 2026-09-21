import { describe, expect, it } from "vitest";
import { conditionalLivePlayerProbability } from "./live-player-probability";

describe("conditionalLivePlayerProbability", () => {
  it("conditions a receiving-yard under on yards already accumulated", () => {
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
    expect(result!.projectedFinal).toBeCloseTo(144, 5);
    expect(result!.probability).toBeGreaterThan(0.55);
    expect(result!.probability).toBeLessThan(0.95);
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

  it("uses only the remaining scoring expectation for count props", () => {
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
    expect(result!.expectedRemaining).toBeCloseTo(0.6, 5);
    expect(result!.probability).toBeGreaterThan(0.4);
    expect(result!.probability).toBeLessThan(0.6);
  });
});
