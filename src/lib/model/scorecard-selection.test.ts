import { describe, expect, it } from "vitest";
import { selectScorecardBucketLeaders, type ReliableScorecardCandidate } from "./scorecard-selection";

const cutoff = new Date("2026-10-29T20:00:00.000Z");
const kickoffAt = new Date("2026-10-30T00:15:00.000Z");
const games = new Map([["CAR-GB", { kickoffAt, bucket: "tnf" }]]);
const rule = { id: "tnf", count: 2 };

function candidate(
  id: string,
  overrides: Partial<ReliableScorecardCandidate> = {},
): ReliableScorecardCandidate {
  return {
    id,
    normalizedMarketId: id,
    predictedAt: new Date("2026-10-29T19:30:00.000Z"),
    features: {
      matchup: "CAR-GB",
      subject: id,
      lynervaScore: 85,
      recommendedSide: "yes",
      recommendedProbabilityBps: 7500,
      probabilityPerspective: "recommended_side",
      projectionSourceCount: 6,
    },
    eventTitle: "Panthers at Packers",
    family: "receiving_yards",
    predictedProbabilityBps: 7500,
    executablePriceBps: 5000,
    edgeBps: 2500,
    reliabilityBps: 8000,
    sampleSize: 6,
    marketStatus: "open",
    quoteFetchedAt: new Date("2026-10-29T19:30:00.000Z"),
    yesAskBps: 5000,
    noAskBps: 5200,
    ...overrides,
  };
}

describe("quality-controlled scorecard selection", () => {
  it("never resurrects an old positive edge after the latest model turns negative", () => {
    const old = candidate("older", { normalizedMarketId: "market-1" });
    const latest = candidate("latest", {
      normalizedMarketId: "market-1",
      predictedAt: new Date("2026-10-29T19:45:00.000Z"),
      edgeBps: -500,
    });
    expect(selectScorecardBucketLeaders([old, latest], games, rule, cutoff)).toEqual([]);
  });

  it("rejects insufficient game history and weak source evidence", () => {
    const weakHistory = candidate("thin history", { sampleSize: 2 });
    const weakSources = candidate("thin sources", {
      features: { ...candidate("a").features, subject: "thin sources", projectionSourceCount: 2 },
    });
    expect(selectScorecardBucketLeaders([weakHistory, weakSources], games, rule, cutoff)).toEqual([]);
  });

  it("does not select stale predictions or contracts whose ask has moved", () => {
    const stale = candidate("stale", { predictedAt: new Date("2026-10-28T12:00:00.000Z") });
    const repriced = candidate("repriced", { yesAskBps: 6000 });
    expect(selectScorecardBucketLeaders([stale, repriced], games, rule, cutoff)).toEqual([]);
  });

  it("rejects sub-60% modeled hit chances and low reliability", () => {
    const longShot = candidate("long shot", {
      features: { ...candidate("a").features, recommendedProbabilityBps: 4800 },
    });
    const unreliable = candidate("unreliable", { reliabilityBps: 5000 });
    expect(selectScorecardBucketLeaders([longShot, unreliable], games, rule, cutoff)).toEqual([]);
  });

  it("avoids multiple markets on the same player and caps each game at two picks", () => {
    const all = [
      candidate("one", { features: { ...candidate("a").features, subject: "Player A" } }),
      candidate("two", { features: { ...candidate("a").features, subject: "Player A" } }),
      candidate("three", { features: { ...candidate("a").features, subject: "Player B" } }),
      candidate("four", { features: { ...candidate("a").features, subject: "Player C" } }),
    ];
    const winners = selectScorecardBucketLeaders(all, games, { id: "tnf", count: 4 }, cutoff);
    expect(winners).toHaveLength(2);
    expect(new Set(winners.map((item) => item.features.subject)).size).toBe(2);
  });

  it("allows unfilled slots rather than forcing poor candidates", () => {
    const selected = selectScorecardBucketLeaders(
      [candidate("qualified"), candidate("unreliable", { reliabilityBps: 3000 })],
      games,
      rule,
      cutoff,
    );
    expect(selected.map((item) => item.id)).toEqual(["qualified"]);
  });
});
