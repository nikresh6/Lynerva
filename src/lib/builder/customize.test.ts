import { describe, expect, it } from "vitest";
import type { MarketOpportunity } from "@/lib/markets/types";
import {
  builderPickDirection,
  findMarketReplacements,
  rebuildCombinationFromLegs,
} from "./customize";

function opportunity(input: {
  id: string;
  matchup: string;
  price: number;
  model: number;
  direction?: "over" | "under";
  side?: "yes" | "no";
  family?: "receiving_yards" | "rushing_yards";
}): MarketOpportunity {
  const direction = input.direction ?? "over";
  const side = input.side ?? "yes";
  return {
    platform: "kalshi",
    platformMarketId: input.id,
    platformOutcomeId: input.id,
    eventTitle: input.matchup,
    marketTitle: input.id,
    outcomeLabel: "Yes",
    resolutionRules: null,
    status: "open",
    isLive: false,
    yesBidBps: input.price - 100,
    yesAskBps: input.price,
    noBidBps: 10_000 - input.price - 100,
    noAskBps: 10_000 - input.price,
    lastPriceBps: input.price,
    liquidityCents: 100_000,
    volumeCents: 100_000,
    closesAt: "2026-10-01T00:00:00.000Z",
    updatedAt: new Date().toISOString(),
    sourceUrl: "https://example.com",
    canonical: {
      key: input.id,
      family: input.family ?? "receiving_yards",
      statistic:
        (input.family ?? "receiving_yards") === "rushing_yards"
          ? "rushing_yards"
          : "receiving_yards",
      direction,
      threshold: 50,
      subject: input.id,
      matchup: input.matchup,
      settlementDate: "2026-10-01",
      regulationOnly: false,
      parseConfidence: "high",
    },
    model: {
      probabilityBps: input.model,
      reliabilityBps: 8_000,
      version: "test",
      evidence: {
        last5Hits: null,
        last10Hits: null,
        seasonHits: null,
        seasonGames: null,
        sampleSize: 0,
      },
      factors: [],
    },
    recommendedSide: side,
    recommendedProbabilityBps:
      side === "yes" ? input.model : 10_000 - input.model,
    executablePriceBps:
      side === "yes" ? input.price : 10_000 - input.price,
    edgeBps: 700,
    expectedRoi: 0.1,
    riskReturn: 1,
    spreadBps: 100,
    opportunityScore: 1,
    lynervaScore: 70,
    scoreBreakdown: {
      value: 70,
      hitRate: 70,
      probability: 70,
      reliability: 70,
      edge: 70,
      marketQuality: 70,
    },
    freshness: "fresh",
    discrepancyBps: null,
    equivalentPlatform: null,
    arbitrage: null,
  };
}

describe("builder customization", () => {
  it("understands the recommended pick direction, including the NO side", () => {
    const over = opportunity({
      id: "OVER",
      matchup: "LAR-NYG",
      price: 5_000,
      model: 5_700,
    });
    const under = opportunity({
      id: "UNDER",
      matchup: "KC-LV",
      price: 4_000,
      model: 3_300,
      side: "no",
    });

    expect(builderPickDirection(over)).toBe("over");
    expect(builderPickDirection(under)).toBe("under");
  });

  it("finds an over replacement near the original odds", () => {
    const target = opportunity({
      id: "TARGET",
      matchup: "LAR-NYG",
      price: 5_000,
      model: 5_800,
    });
    const closeOver = opportunity({
      id: "CLOSE",
      matchup: "KC-LV",
      price: 5_300,
      model: 6_200,
    });
    const farOver = opportunity({
      id: "FAR",
      matchup: "BUF-MIA",
      price: 7_800,
      model: 8_500,
    });
    const closeUnder = opportunity({
      id: "WRONG-DIRECTION",
      matchup: "DAL-PHI",
      price: 4_800,
      model: 4_100,
      side: "no",
    });

    const replacements = findMarketReplacements(
      [target, closeOver, farOver, closeUnder],
      target,
      {
        direction: "over",
        toleranceBps: 1_000,
        mode: "multi_game",
      },
    );

    expect(replacements.map((row) => row.platformMarketId)).toEqual(["CLOSE"]);
  });

  it("recalculates parlay economics after a leg swap", () => {
    const first = opportunity({
      id: "A",
      matchup: "LAR-NYG",
      price: 5_000,
      model: 5_800,
    });
    const second = opportunity({
      id: "B",
      matchup: "KC-LV",
      price: 4_000,
      model: 4_800,
    });

    const rebuilt = rebuildCombinationFromLegs([first, second]);

    expect(rebuilt).not.toBeNull();
    expect(rebuilt!.grossReturn).toBeCloseTo(5, 5);
    expect(rebuilt!.estimatedProbability).toBeCloseTo(0.2784, 4);
    expect(rebuilt!.expectedValueMultiplier).toBeGreaterThan(1);
  });
});
