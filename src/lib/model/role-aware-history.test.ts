import { describe, expect, it } from "vitest";
import { estimatePlayerRoleContext } from "./role-aware-history";

function game(
  week: number,
  value: number,
  rushingAttempts: number,
) {
  return {
    season: 2026,
    week,
    value,
    rushingAttempts,
  };
}

describe("role-aware player history", () => {
  it("downweights old hit-rate evidence when recent opportunity jumps", () => {
    const context = estimatePlayerRoleContext({
      family: "rushing_yards",
      currentProjection: 66,
      threshold: 49.5,
      direction: "over",
      games: [
        game(5, 64, 15),
        game(4, 58, 14),
        game(3, 21, 5),
        game(2, 18, 4),
        game(1, 11, 3),
      ],
    });

    expect(context.roleShift).toBe("up");
    expect(context.roleContinuity).toBeLessThan(0.6);
    expect(context.recencyWeightedHitRate ?? 0).toBeGreaterThan(
      context.rawHitRate ?? 0,
    );
  });

  it("keeps normal relevance when opportunity is stable", () => {
    const context = estimatePlayerRoleContext({
      family: "rushing_yards",
      currentProjection: 52,
      threshold: 49.5,
      direction: "over",
      games: [
        game(5, 54, 12),
        game(4, 47, 11),
        game(3, 51, 12),
        game(2, 46, 10),
        game(1, 53, 11),
      ],
    });

    expect(context.roleShift).toBe("stable");
    expect(context.roleContinuity).toBe(1);
  });
});
