import { describe, expect, it } from "vitest";
import { estimatePlayerStatStdDev } from "./player-variance";

describe("projection-sensitive player variance", () => {
  it("gives low-volume receivers much tighter yardage distributions", () => {
    const fringe = estimatePlayerStatStdDev({
      family: "receiving_yards",
      projection: 3,
      position: "WR",
      currentSeasonValues: [],
    });
    const starter = estimatePlayerStatStdDev({
      family: "receiving_yards",
      projection: 70,
      position: "WR",
      currentSeasonValues: [],
    });

    expect(fringe.stdDev).toBeLessThan(12);
    expect(starter.stdDev).toBeGreaterThan(fringe.stdDev * 2);
  });

  it("changes quarterback rushing variance with projected rushing volume", () => {
    const thirty = estimatePlayerStatStdDev({
      family: "rushing_yards",
      projection: 30,
      position: "QB",
      currentSeasonValues: [],
    });
    const forty = estimatePlayerStatStdDev({
      family: "rushing_yards",
      projection: 40,
      position: "QB",
      currentSeasonValues: [],
    });

    expect(forty.stdDev).toBeGreaterThan(thirty.stdDev);
  });

  it("starts player-specific learning at four games and increases its weight", () => {
    const threeGames = estimatePlayerStatStdDev({
      family: "receiving_yards",
      projection: 55,
      position: "WR",
      currentSeasonValues: [40, 75, 50],
    });
    const fourGames = estimatePlayerStatStdDev({
      family: "receiving_yards",
      projection: 55,
      position: "WR",
      currentSeasonValues: [40, 75, 50, 95],
    });
    const tenGames = estimatePlayerStatStdDev({
      family: "receiving_yards",
      projection: 55,
      position: "WR",
      currentSeasonValues: [40, 75, 50, 95, 20, 88, 62, 31, 105, 44],
    });

    expect(threeGames.playerHistoryWeight).toBe(0);
    expect(fourGames.playerHistoryWeight).toBeGreaterThan(0);
    expect(tenGames.playerHistoryWeight).toBeGreaterThan(
      fourGames.playerHistoryWeight,
    );
  });

  it("uses each player's own four-game distribution", () => {
    const steadyPlayer = estimatePlayerStatStdDev({
      family: "rushing_yards",
      projection: 55,
      position: "RB",
      currentSeasonValues: [52, 57, 54, 58],
    });
    const volatilePlayer = estimatePlayerStatStdDev({
      family: "rushing_yards",
      projection: 55,
      position: "RB",
      currentSeasonValues: [8, 104, 19, 96],
    });

    expect(steadyPlayer.observedStdDev).toBeLessThan(
      volatilePlayer.observedStdDev!,
    );
    expect(steadyPlayer.stdDev).toBeLessThan(volatilePlayer.stdDev);
  });
});
