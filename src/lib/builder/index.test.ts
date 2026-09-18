import { describe, expect, it } from "vitest";
import { buildBestAvailableCombination, buildCombination } from "./index";
import type { MarketOpportunity } from "@/lib/markets/types";

function opportunity(
  id: string,
  matchup: string,
  price: number,
  model: number,
): MarketOpportunity {
  return {
    platform: "kalshi",
    platformMarketId: id,
    platformOutcomeId: id,
    eventTitle: matchup,
    marketTitle: `${id} to win`,
    outcomeLabel: "Yes",
    resolutionRules: "Includes overtime",
    status: "open",
    isLive: false,
    yesBidBps: price - 100,
    yesAskBps: price,
    noBidBps: 10_000 - price - 100,
    noAskBps: 10_000 - price,
    lastPriceBps: price,
    liquidityCents: 100_000,
    volumeCents: 100_000,
    closesAt: "2026-10-01T00:00:00.000Z",
    updatedAt: new Date().toISOString(),
    sourceUrl: "https://example.com",
    canonical: {
      key: id,
      family: "moneyline",
      statistic: "game_winner",
      direction: "yes",
      threshold: null,
      subject: id,
      matchup,
      settlementDate: "2026-10-01",
      regulationOnly: false,
      parseConfidence: "high",
    },
    model: {
      probabilityBps: model,
      reliabilityBps: 8_000,
      version: "test",
      evidence: {
        last5Hits: 3,
        last10Hits: 6,
        seasonHits: 8,
        seasonGames: 12,
        sampleSize: 12,
      },
      factors: [],
    },
    recommendedSide: "yes",
    recommendedProbabilityBps: model,
    executablePriceBps: price,
    edgeBps: model - price,
    expectedRoi: (model - price) / price,
    riskReturn: (10_000 - price) / price,
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

const baseOptions = {
  platform: "either" as const,
  live: "pregame" as const,
  mode: "multi_game" as const,
  objective: "balanced" as const,
};

describe("combination builder", () => {
  it("finds a positive-edge combination inside the return target", () => {
    const result = buildCombination(
      [
        opportunity("A", "KC-BUF", 5_000, 5_700),
        opportunity("B", "DAL-PHI", 5_000, 5_600),
      ],
      {
        ...baseOptions,
        minReturn: 3.5,
        maxReturn: 4.5,
        maxLegs: 3,
      },
    );
    expect(result?.legs).toHaveLength(2);
    expect(result?.grossReturn).toBe(4);
    expect(result?.correlationWarning).toBe(false);
  });

  it("never uses the same underlying contract twice across platforms", () => {
    const first = opportunity("A", "KC-BUF", 5_000, 5_700);
    const duplicate = {
      ...opportunity("B", "KC-BUF", 5_000, 5_700),
      platform: "polymarket" as const,
      canonical: first.canonical,
    };
    const other = opportunity("C", "DAL-PHI", 5_000, 5_600);
    const result = buildCombination([first, duplicate, other], {
      ...baseOptions,
      minReturn: 3.5,
      maxReturn: 4.5,
      maxLegs: 3,
      mode: "any",
    });
    expect(result?.legs).toHaveLength(2);
    expect(
      result?.legs.filter((leg) => leg.canonical?.key === first.canonical?.key),
    ).toHaveLength(1);
  });

  it("never silently relaxes the requested market state", () => {
    const live = {
      ...opportunity("LIVE", "BUF-DET", 2_100, 2_538),
      isLive: true,
    };
    const result = buildBestAvailableCombination([live], {
      ...baseOptions,
      minReturn: 3,
      maxReturn: 5,
      maxLegs: 4,
    });
    expect(result).toBeNull();
  });

  it("keeps cross-game mode to one leg per matchup", () => {
    const result = buildCombination(
      [
        opportunity("A", "KC-BUF", 5_000, 5_700),
        opportunity("B", "KC-BUF", 5_000, 5_600),
      ],
      {
        ...baseOptions,
        minReturn: 3.5,
        maxReturn: 4.5,
        maxLegs: 3,
      },
    );
    expect(result).toBeNull();
  });

  it("builds same-game combinations in SGP mode", () => {
    const result = buildCombination(
      [
        opportunity("A", "KC-BUF", 5_000, 6_100),
        opportunity("B", "KC-BUF", 5_000, 6_000),
        opportunity("C", "DAL-PHI", 5_000, 7_000),
      ],
      {
        ...baseOptions,
        minReturn: 3.8,
        maxReturn: 4.2,
        maxLegs: 3,
        mode: "sgp",
      },
    );

    expect(result?.legs).toHaveLength(2);
    expect(new Set(result?.legs.map((leg) => leg.canonical?.matchup)).size).toBe(
      1,
    );
    expect(result?.correlationWarning).toBe(true);
  });

  it("optimizes the combination instead of blindly taking the highest-score legs", () => {
    const decoys = Array.from({ length: 35 }, (_, index) => ({
      ...opportunity(
        "D" + index,
        "DEC" + index + "-OPP" + index,
        5_000,
        5_150,
      ),
      lynervaScore: 95 - (index % 5),
    }));
    const bestOne = {
      ...opportunity("VALUE1", "KC-BUF", 5_000, 7_000),
      lynervaScore: 55,
    };
    const bestTwo = {
      ...opportunity("VALUE2", "DAL-PHI", 5_000, 6_900),
      lynervaScore: 54,
    };

    const result = buildCombination([...decoys, bestOne, bestTwo], {
      ...baseOptions,
      minReturn: 3.9,
      maxReturn: 4.1,
      maxLegs: 2,
    });

    expect(result?.legs.map((leg) => leg.platformMarketId).sort()).toEqual([
      "VALUE1",
      "VALUE2",
    ]);
    expect(result?.estimatedProbability ?? 0).toBeGreaterThan(0.4);
  });

  it("does not stack alternate lines from the same player and stat", () => {
    const first = opportunity("CHASE70", "CIN-HOU", 5_000, 6_500);
    first.canonical = {
      ...first.canonical!,
      key: "chase-over-70",
      family: "receiving_yards",
      statistic: "receiving_yards",
      subject: "Ja'Marr Chase",
      threshold: 70.5,
      direction: "over",
    };

    const second = opportunity("CHASE80", "CIN-HOU", 5_000, 6_400);
    second.canonical = {
      ...second.canonical!,
      key: "chase-over-80",
      family: "receiving_yards",
      statistic: "receiving_yards",
      subject: "Ja'Marr Chase",
      threshold: 80.5,
      direction: "over",
    };

    const other = opportunity("OTHER", "DAL-PHI", 5_000, 6_200);
    const result = buildCombination([first, second, other], {
      ...baseOptions,
      minReturn: 3.9,
      maxReturn: 4.1,
      maxLegs: 2,
      mode: "any",
    });

    expect(result?.legs).toHaveLength(2);
    expect(
      result?.legs.filter(
        (leg) =>
          leg.canonical?.subject === "Ja'Marr Chase" &&
          leg.canonical?.family === "receiving_yards",
      ),
    ).toHaveLength(1);
  });

  it("rejects ordinary builds where one longshot carries almost all the payout", () => {
    const result = buildCombination(
      [
        opportunity("SAFE", "KC-BUF", 8_000, 9_000),
        opportunity("LONG", "DAL-PHI", 1_500, 1_800),
      ],
      {
        ...baseOptions,
        minReturn: 8,
        maxReturn: 9,
        maxLegs: 2,
      },
    );

    expect(result).toBeNull();
  });

  it("allows a concentrated build when the longshot has exceptional model value", () => {
    const result = buildCombination(
      [
        opportunity("SAFE", "KC-BUF", 8_000, 9_000),
        opportunity("LONG", "DAL-PHI", 2_000, 4_500),
      ],
      {
        ...baseOptions,
        minReturn: 6,
        maxReturn: 6.5,
        maxLegs: 2,
      },
    );

    expect(result?.legs).toHaveLength(2);
    expect(result?.maxOddsContributionShare ?? 0).toBeGreaterThan(0.7);
  });

  it("never returns a single leg as a parlay", () => {
    const result = buildCombination(
      [opportunity("LONGSHOT", "KC-BUF", 2_500, 3_200)],
      {
        ...baseOptions,
        minReturn: 3.5,
        maxReturn: 4.5,
        maxLegs: 2,
      },
    );

    expect(result).toBeNull();
  });
});
