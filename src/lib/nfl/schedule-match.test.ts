import { describe, expect, it } from "vitest";
import type { CanonicalMarket } from "@/lib/markets/types";
import {
  findEligibleScheduleGame,
  isEligibleNflSeasonType,
  type NflScheduleGame,
} from "./schedule-match";

const canonical: CanonicalMarket = {
  key: "test",
  family: "passing_yards",
  statistic: "passing_yards",
  direction: "over",
  threshold: 249.5,
  subject: "Josh Allen",
  matchup: "BUF-DET",
  settlementDate: "2026-09-18",
  regulationOnly: false,
  parseConfidence: "high",
};

function game(overrides: Partial<NflScheduleGame> = {}): NflScheduleGame {
  return {
    gameId: "2026_02_DET_BUF",
    season: 2026,
    week: 2,
    seasonType: "REG",
    gameday: "2026-09-17",
    kickoffAt: "2026-09-18T00:15:00.000Z",
    homeTeam: "BUF",
    awayTeam: "DET",
    stadium: "Highmark Stadium",
    roof: "outdoors",
    ...overrides,
  };
}

describe("NFL schedule eligibility", () => {
  it("accepts regular season and playoff game types", () => {
    expect(isEligibleNflSeasonType("REG")).toBe(true);
    expect(isEligibleNflSeasonType("WC")).toBe(true);
    expect(isEligibleNflSeasonType("DIV")).toBe(true);
    expect(isEligibleNflSeasonType("CON")).toBe(true);
    expect(isEligibleNflSeasonType("SB")).toBe(true);
  });

  it("rejects preseason games", () => {
    expect(isEligibleNflSeasonType("PRE")).toBe(false);
    expect(
      findEligibleScheduleGame(
        canonical,
        [game({ seasonType: "PRE" })],
        new Date("2026-09-17T23:30:00.000Z").getTime(),
      ),
    ).toBeNull();
  });

  it("rejects season futures and unrelated NFL markets with no matchup", () => {
    expect(
      findEligibleScheduleGame(
        { ...canonical, matchup: null, settlementDate: "2027-01-12" },
        [game()],
        new Date("2026-09-17T23:30:00.000Z").getTime(),
      ),
    ).toBeNull();
  });

  it("accepts the real regular-season game even when UTC close date is next day", () => {
    expect(
      findEligibleScheduleGame(
        canonical,
        [game()],
        new Date("2026-09-17T23:30:00.000Z").getTime(),
      )?.gameId,
    ).toBe("2026_02_DET_BUF");
  });
});
