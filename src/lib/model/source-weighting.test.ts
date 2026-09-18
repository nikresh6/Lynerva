import { describe, expect, it } from "vitest";
import { calculateSourceWeights } from "./source-weighting";

function samples(
  source: string,
  count: number,
  error: number,
  start = 0,
) {
  return Array.from({ length: count }, (_, index) => ({
    source,
    absoluteError: error,
    gradedAt: new Date(2026, 0, 1, 0, 0, start + index),
  }));
}

describe("source weighting", () => {
  it("keeps tiny samples at equal weights", () => {
    const weights = calculateSourceWeights(
      [
        ...samples("espn", 10, 2),
        ...samples("cbs", 10, 20),
      ],
      ["espn", "cbs"],
    );
    expect(weights[0]?.weight).toBeCloseTo(0.5, 8);
    expect(weights[1]?.weight).toBeCloseTo(0.5, 8);
  });

  it("gives more weight to a consistently more accurate source", () => {
    const weights = calculateSourceWeights(
      [
        ...samples("espn", 220, 5),
        ...samples("cbs", 220, 15),
      ],
      ["espn", "cbs"],
    );
    const espn = weights.find((item) => item.source === "espn")!;
    const cbs = weights.find((item) => item.source === "cbs")!;
    expect(espn.weight).toBeGreaterThan(cbs.weight);
    expect(espn.weight + cbs.weight).toBeCloseTo(1, 10);
  });

  it("uses recent performance without discarding long-run accuracy", () => {
    const oldDate = new Date("2026-09-01T00:00:00Z");
    const recentDate = new Date("2026-09-20T00:00:00Z");
    const rows = [
      ...Array.from({ length: 180 }, () => ({
        source: "espn",
        absoluteError: 8,
        gradedAt: oldDate,
      })),
      ...Array.from({ length: 40 }, () => ({
        source: "espn",
        absoluteError: 2,
        gradedAt: recentDate,
      })),
      ...Array.from({ length: 220 }, () => ({
        source: "cbs",
        absoluteError: 8,
        gradedAt: oldDate,
      })),
    ];
    const weights = calculateSourceWeights(rows, ["espn", "cbs"]);
    expect(
      weights.find((item) => item.source === "espn")!.weight,
    ).toBeGreaterThan(
      weights.find((item) => item.source === "cbs")!.weight,
    );
  });
});
