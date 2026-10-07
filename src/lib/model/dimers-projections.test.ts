import { describe, expect, it } from "vitest";
import {\n  parseDimersProjectionResponse,\n  parseDimersProjectionTableRows,\n} from "./dimers-projections";

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


describe("Dimers public projection table fallback", () => {
  it("parses only visible numeric player rows", () => {
    const rows = [
      ["J. Gibbs", "1", "RB", "DET", "27.1", "24.8", "0.0", "0.0", "94.7", "4.6", "40.9", "71.5%", "35.7%", "13.3%", "18.9%", "DET vs. ARI"],
      ["J. Allen", "2", "QB", "BUF", "24.2", "24.2", "20.8", "245.7", "40.0", "0.0", "0.0", "51.7%", "16.6%", "3.8%", "10.0%", "BUF vs. LA"],
      ["P. Nacua", "4", "WR", "LA", "Locked", "Locked", "Locked", "Locked", "Locked", "Locked", "Locked", "Locked"],
    ];

    const parsed = parseDimersProjectionTableRows(rows);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      player: "J. Gibbs",
      position: "RB",
      rushingYards: 94.7,
      receptions: 4.6,
      receivingYards: 40.9,
    });
    expect(parsed[0]?.totalTouchdowns).toBeCloseTo(-Math.log(1 - 0.715), 6);
    expect(parsed[1]).toMatchObject({
      player: "J. Allen",
      position: "QB",
      passingYards: 245.7,
      rushingYards: 40,
    });
  });
});
