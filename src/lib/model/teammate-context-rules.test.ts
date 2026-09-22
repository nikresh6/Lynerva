import { describe, expect, it } from "vitest";
import {
  passingEfficiencyLossRate,
  teammateContextMode,
  teammateVolumeFamily,
} from "./teammate-context-rules";

describe("teammate context role rules", () => {
  it("does not give an RB rushing yards because a WR is out", () => {
    expect(
      teammateContextMode({
        family: "rushing_yards",
        targetPosition: "RB",
        teammatePosition: "WR",
      }),
    ).toBeNull();
  });

  it("does not give a QB rushing yards because a WR is out", () => {
    expect(
      teammateContextMode({
        family: "rushing_yards",
        targetPosition: "QB",
        teammatePosition: "WR",
      }),
    ).toBeNull();
  });

  it("redistributes rushing workload inside the RB room", () => {
    expect(
      teammateContextMode({
        family: "rushing_yards",
        targetPosition: "RB",
        teammatePosition: "RB",
      }),
    ).toBe("rushing_redistribution");
  });

  it("redistributes receiving opportunity among pass catchers", () => {
    expect(
      teammateContextMode({
        family: "receiving_yards",
        targetPosition: "WR",
        teammatePosition: "WR",
      }),
    ).toBe("receiving_redistribution");
    expect(
      teammateContextMode({
        family: "receptions",
        targetPosition: "TE",
        teammatePosition: "RB",
      }),
    ).toBe("receiving_redistribution");
  });

  it("treats a missing pass catcher as a QB passing-efficiency loss", () => {
    expect(
      teammateContextMode({
        family: "passing_yards",
        targetPosition: "QB",
        teammatePosition: "WR",
      }),
    ).toBe("passing_efficiency_loss");
    expect(teammateVolumeFamily("passing_yards")).toBe("receiving_yards");
    expect(passingEfficiencyLossRate("WR")).toBeGreaterThan(
      passingEfficiencyLossRate("RB"),
    );
  });
});
