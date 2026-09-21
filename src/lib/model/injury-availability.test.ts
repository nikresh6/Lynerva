import { describe, expect, it } from "vitest";
import { estimateInjuryAvailability } from "./injury-availability";

describe("pregame injury availability", () => {
  it("heavily discounts a questionable game-time decision who missed practice", () => {
    const estimate = estimateInjuryAvailability({
      status: "Questionable",
      detail: "Game-time decision with hip and groin soreness",
      practiceParticipation: "Did Not Participate",
      sources: ["espn", "sleeper"],
    });

    expect(estimate).not.toBeNull();
    expect(estimate!.playProbability).toBeLessThan(0.5);
    expect(estimate!.finishProbabilityIfActive).toBeLessThan(0.8);
    expect(estimate!.risk).toBe("high");
  });

  it("keeps a probable full participant close to normal availability", () => {
    const estimate = estimateInjuryAvailability({
      status: "Probable",
      practiceParticipation: "Full Practice",
      bodyPart: "Shoulder",
    });

    expect(estimate).not.toBeNull();
    expect(estimate!.playProbability).toBeGreaterThan(0.95);
    expect(estimate!.expectedUsageIfActive).toBeGreaterThan(0.9);
  });

  it("treats a ruled-out player as zero availability", () => {
    const estimate = estimateInjuryAvailability({
      status: "Out",
      detail: "Ruled out for the game",
    });

    expect(estimate).not.toBeNull();
    expect(estimate!.playProbability).toBe(0);
    expect(estimate!.finishProbabilityIfActive).toBe(0);
    expect(estimate!.risk).toBe("out");
  });
});
