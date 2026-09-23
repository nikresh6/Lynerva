import { describe, expect, it } from "vitest";
import { parseDimersProjectionResponse } from "./dimers-projections";

const response = [
  {
    MatchData: { Sport: "NFL", Season: 2026, RoundNumber: 3 },
    projBoxScore: {
      home: [
        {
          first_name: "MarShawn",
          last_name: "Lloyd",
          position: "RB",
          rushYds: 36.6940106392,
          rec: 1.3781,
          recYds: 10.0449,
          anytimeTD: 0.3277,
        },
      ],
      away: [],
    },
  },
];

describe("Dimers projection feed", () => {
  it("parses the exact player/stat projections used by the public site", () => {
    const rows = parseDimersProjectionResponse(response, 2026, 3);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      player: "MarShawn Lloyd",
      position: "RB",
      rushingYards: 36.6940106392,
      receptions: 1.3781,
      receivingYards: 10.0449,
    });
    expect(rows[0]?.totalTouchdowns).toBeCloseTo(-Math.log(1 - 0.3277));
  });

  it("rejects a stale or mismatched round", () => {
    expect(parseDimersProjectionResponse(response, 2026, 4)).toEqual([]);
    expect(parseDimersProjectionResponse(response, 2025, 3)).toEqual([]);
  });

  it("does not admit malformed or negative projections", () => {
    const malformed = structuredClone(response);
    const player = malformed[0]!.projBoxScore.home[0]!;
    player.rushYds = -10;
    player.rec = Number.NaN;
    player.recYds = -2;
    player.anytimeTD = 200;
    expect(parseDimersProjectionResponse(malformed, 2026, 3)).toEqual([]);
  });
});
