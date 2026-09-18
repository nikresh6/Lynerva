import { describe, expect, it } from "vitest";
import { empiricalPlayerProbability, poissonAtLeastProbability } from "./player-probability";

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
