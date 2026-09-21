import { describe, expect, it } from "vitest";
import {
  blendConditionalWithDnpFairValueBps,
  estimateInjuryAvailability,
} from "./injury-availability";

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

  it("uses late news that says a questionable player is trending toward sitting", () => {
    const baseline = estimateInjuryAvailability({
      status: "Questionable",
      bodyPart: "Hip",
    });
    const withNews = estimateInjuryAvailability({
      status: "Questionable",
      bodyPart: "Hip",
      news: "Adam Schefter reports the player is trending toward not playing tonight.",
      sources: ["ESPN", "FantasyPros News"],
    });

    expect(baseline).not.toBeNull();
    expect(withNews).not.toBeNull();
    expect(withNews!.playProbability).toBeLessThan(baseline!.playProbability);
    expect(withNews!.risk).toBe("high");
  });

  it("treats an inactive news report as zero availability", () => {
    const estimate = estimateInjuryAvailability({
      status: "Questionable",
      news: "The player is officially inactive for Week 2 and will not play.",
    });

    expect(estimate).not.toBeNull();
    expect(estimate!.playProbability).toBe(0);
    expect(estimate!.risk).toBe("out");
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

  it("ignores veteran-rest-only practice listings", () => {
    expect(
      estimateInjuryAvailability({
        practiceParticipation: "Did Not Participate",
        practiceDescription: "Veteran rest, not injury related",
      }),
    ).toBeNull();
  });

  it("blends conditional football value with Kalshi's DNP fair-value branch", () => {
    expect(
      blendConditionalWithDnpFairValueBps({
        conditionalProbabilityBps: 7800,
        playProbabilityBps: 5000,
        dnpFairValueBps: 5000,
      }),
    ).toBe(6400);
    expect(
      blendConditionalWithDnpFairValueBps({
        conditionalProbabilityBps: 7800,
        playProbabilityBps: 10_000,
        dnpFairValueBps: 5000,
      }),
    ).toBe(7800);
  });
});
