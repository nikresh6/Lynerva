import { describe, expect, it } from "vitest";
import { findCurrentRegularSeasonGame } from "./current-game";
import type { LiveNflGame } from "./live";

function game(state: LiveNflGame["state"]): LiveNflGame {
  return {
    id: "1",
    name: "Detroit Lions at Buffalo Bills",
    startsAt: "2026-09-18T00:15:00.000Z",
    seasonYear: 2026,
    seasonType: 2,
    week: 2,
    state,
    status: state === "post" ? "Final" : "3rd Quarter",
    period: state === "pre" ? 0 : 3,
    clock: state === "pre" ? "0:00" : "10:00",
    home: { team: "BUF", score: state === "pre" ? 0 : 27, timeouts: 2 },
    away: { team: "DET", score: state === "pre" ? 0 : 10, timeouts: 1 },
    possession: null,
    updatedAt: "2026-09-18T02:00:00.000Z",
  };
}

describe("current regular-season market eligibility", () => {
  it("keeps pregame and live games", () => {
    expect(findCurrentRegularSeasonGame("BUF-DET", [game("pre")])).not.toBeNull();
    expect(findCurrentRegularSeasonGame("BUF-DET", [game("in")])).not.toBeNull();
  });

  it("drops every market as soon as the game is final", () => {
    expect(findCurrentRegularSeasonGame("BUF-DET", [game("post")])).toBeNull();
  });

  it("rejects playoff games", () => {
    const playoff = { ...game("pre"), seasonType: 3 };
    expect(findCurrentRegularSeasonGame("BUF-DET", [playoff])).toBeNull();
  });
});
