import { describe, expect, it } from "vitest";
import {
  ACTIVE_PROJECTION_SOURCES,
  calculateSourceAccuracyMetrics,
  calculateSourceWeights,
} from "./source-weighting";

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
  it("keeps the active source list unique", () => {
    expect(new Set(ACTIVE_PROJECTION_SOURCES).size).toBe(
      ACTIVE_PROJECTION_SOURCES.length,
    );
    expect(ACTIVE_PROJECTION_SOURCES).toHaveLength(8);
  });

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

  it("does not let one absurd miss destroy an otherwise accurate source", () => {
    const rows = [
      ...samples("espn", 219, 5),
      {
        source: "espn",
        absoluteError: 200,
        gradedAt: new Date("2026-09-20T00:00:00Z"),
      },
      ...samples("cbs", 220, 7),
    ];
    const weights = calculateSourceWeights(rows, ["espn", "cbs"]);
    const espn = weights.find((item) => item.source === "espn")!;
    const cbs = weights.find((item) => item.source === "cbs")!;
    expect(espn.weight).toBeGreaterThan(cbs.weight);
  });

  it("does not reward sources for padding the sample with trivial near-zero calls", () => {
    const date = new Date("2026-09-20T00:00:00Z");
    const rows = [
      ...Array.from({ length: 200 }, () => ({
        source: "bench-heavy",
        statistic: "receiving_yards",
        projectedValue: 1.1,
        actualValue: 0,
        absoluteError: 1.1,
        gradedAt: date,
      })),
      ...Array.from({ length: 200 }, () => ({
        source: "starter-heavy",
        statistic: "receiving_yards",
        projectedValue: 128,
        actualValue: 125,
        absoluteError: 3,
        gradedAt: date,
      })),
    ];

    const metrics = calculateSourceAccuracyMetrics(rows, [
      "bench-heavy",
      "starter-heavy",
    ]);
    const bench = metrics.find((item) => item.source === "bench-heavy")!;
    const starter = metrics.find((item) => item.source === "starter-heavy")!;

    expect(bench.effectiveSampleSize).toBeLessThan(20);
    expect(starter.effectiveSampleSize).toBeGreaterThan(150);
    expect(starter.normalizedRobustError ?? 1).toBeLessThan(
      bench.normalizedRobustError ?? 0,
    );

    const weights = calculateSourceWeights(rows, [
      "bench-heavy",
      "starter-heavy",
    ]);
    expect(
      weights.find((item) => item.source === "starter-heavy")!.weight,
    ).toBeGreaterThan(
      weights.find((item) => item.source === "bench-heavy")!.weight,
    );
  });

  it("still penalizes a tiny projection when the player actually produces", () => {
    const date = new Date("2026-09-20T00:00:00Z");
    const rows = [
      {
        source: "bad-zero",
        statistic: "receiving_yards",
        projectedValue: 1,
        actualValue: 45,
        absoluteError: 44,
        gradedAt: date,
      },
      {
        source: "good-starter",
        statistic: "receiving_yards",
        projectedValue: 48,
        actualValue: 45,
        absoluteError: 3,
        gradedAt: date,
      },
    ];
    const metrics = calculateSourceAccuracyMetrics(rows, [
      "bad-zero",
      "good-starter",
    ]);
    expect(
      metrics.find((item) => item.source === "bad-zero")!
        .normalizedRobustError ?? 0,
    ).toBeGreaterThan(
      metrics.find((item) => item.source === "good-starter")!
        .normalizedRobustError ?? 1,
    );
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
