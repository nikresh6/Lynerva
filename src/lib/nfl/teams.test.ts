import { describe, expect, it } from "vitest";
import {
  findNflTeamsInQuery,
  getNflTeam,
  resolveNflTeamQuery,
} from "./teams";

describe("NFL team search", () => {
  it("resolves city, nickname, full name, and abbreviations", () => {
    expect(resolveNflTeamQuery("Detroit")?.code).toBe("DET");
    expect(resolveNflTeamQuery("Lions")?.code).toBe("DET");
    expect(resolveNflTeamQuery("Detroit Lions")?.code).toBe("DET");
    expect(resolveNflTeamQuery("DET")?.code).toBe("DET");
  });

  it("recognizes two teams in a natural matchup search", () => {
    expect(
      findNflTeamsInQuery("Chiefs vs Ravens")
        .map((team) => team.code)
        .toSorted(),
    ).toEqual(["BAL", "KC"]);
  });

  it("normalizes Washington's alternate abbreviation", () => {
    expect(getNflTeam("WSH")?.code).toBe("WAS");
  });
});
