import { describe, expect, it } from "vitest";
import { canPublishPlayerProbability, empiricalPlayerProbability, poissonAtLeastProbability } from "./player-probability";

describe("empirical player probability", () => {
  it("keeps a never-hit high line appropriately low", () => {
    const probability = empiricalPlayerProbability({
      historicalHitRate: 0,
      recentHitRate: 0,
      recentPerformanceRatio: 0.65,
      sampleSize: 20,
    });
    expect(probability).toBeLessThan(0.08);
  });

  it("keeps a frequently hit line near its observed rate", () => {
    const probability = empiricalPlayerProbability({
      historicalHitRate: 0.7,
      recentHitRate: 0.8,
      recentPerformanceRatio: 1.08,
      sampleSize: 20,
    });
    expect(probability).toBeGreaterThan(0.65);
    expect(probability).toBeLessThan(0.8);
  });

  it("never emits fake certainty", () => {
    expect(
      empiricalPlayerProbability({
        historicalHitRate: 1,
        recentHitRate: 1,
        recentPerformanceRatio: 2,
        sampleSize: 20,
      }),
    ).toBeLessThanOrEqual(0.98);
  });
});


describe("poissonAtLeastProbability", () => {
  it("keeps 3+ touchdown long shots in the low tail", () => {
    const probability = poissonAtLeastProbability(3, 0.5);
    expect(probability).toBeGreaterThan(0.01);
    expect(probability).toBeLessThan(0.02);
  });

  it("returns a sensible 1+ touchdown chance", () => {
    const probability = poissonAtLeastProbability(1, 0.7);
    expect(probability).toBeCloseTo(1 - Math.exp(-0.7), 6);
  });
});


describe("player probability publication guard", () => {
  it("does not echo a market price when no independent player data exists", () => {
    expect(
      canPublishPlayerProbability({
        hasExternalProjection: false,
        projectionSourceCount: 0,
        historyCount: 0,
      }),
    ).toBe(false);
  });

  it("allows a prop once independent weekly projections exist", () => {
    expect(
      canPublishPlayerProbability({
        hasExternalProjection: true,
        projectionSourceCount: 1,
        historyCount: 0,
      }),
    ).toBe(true);
  });

  it("allows a prop after four current-season results even without a projection", () => {
    expect(
      canPublishPlayerProbability({
        hasExternalProjection: false,
        projectionSourceCount: 0,
        historyCount: 4,
      }),
    ).toBe(true);
  });
});


it("requires multiple independent projections for unsupported-history markets", () => {
  expect(
    canPublishPlayerProbability({
      hasExternalProjection: true,
      projectionSourceCount: 1,
      minimumProjectionSources: 3,
      historyCount: 0,
    }),
  ).toBe(false);

  expect(
    canPublishPlayerProbability({
      hasExternalProjection: true,
      projectionSourceCount: 3,
      minimumProjectionSources: 3,
      historyCount: 0,
    }),
  ).toBe(true);
});
