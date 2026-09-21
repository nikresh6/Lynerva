import { describe, expect, it } from "vitest";
import type { MarketOpportunity } from "@/lib/markets/types";
import { buildPortfolioPlan } from "./portfolio";

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
    marketTitle: `${id} market`,
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
        last5Hits: 4,
        last10Hits: 7,
        seasonHits: 9,
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
    lynervaScore: 75,
    scoreBreakdown: {
      value: 75,
      hitRate: 75,
      probability: 75,
      reliability: 80,
      edge: 75,
      marketQuality: 75,
    },
    freshness: "fresh",
    discrepancyBps: null,
    equivalentPlatform: null,
    arbitrage: null,
  };
}

function playerProp(
  id: string,
  subject: string,
  family:
    | "passing_yards"
    | "rushing_yards"
    | "receiving_yards"
    | "receptions"
    | "touchdowns",
  price: number,
  model: number,
): MarketOpportunity {
  const market = opportunity(id, "LAR-NYG", price, model);
  return {
    ...market,
    marketTitle: `${subject} ${family}`,
    canonical: {
      ...market.canonical!,
      key: id,
      family,
      statistic: family,
      direction: family === "touchdowns" ? "yes" : "over",
      threshold: family === "touchdowns" ? 0.5 : 50,
      subject,
      matchup: "LAR-NYG",
    },
  };
}

const markets = [
  opportunity("A", "KC-BUF", 6_600, 7_400),
  opportunity("B", "DAL-PHI", 6_300, 7_200),
  opportunity("C", "DET-GB", 6_100, 7_000),
  opportunity("D", "MIN-CHI", 5_900, 6_900),
  opportunity("E", "BAL-CIN", 5_700, 6_700),
  opportunity("F", "SF-LAR", 5_500, 6_500),
  opportunity("G", "NYJ-MIA", 5_300, 6_300),
  opportunity("H", "ATL-TB", 5_100, 6_100),
  opportunity("I", "SEA-ARI", 4_900, 5_900),
  opportunity("J", "LV-DEN", 4_700, 5_800),
];

describe("bankroll portfolio builder", () => {
  it("uses the full requested amount and mixes straights with parlays", () => {
    const plan = buildPortfolioPlan(markets, {
      amount: 100,
      targetPayout: 300,
      risk: "balanced",
      platform: "either",
      live: "pregame",
      mode: "multi_game",
      maxLegs: 6,
    });

    expect(plan).not.toBeNull();
    expect(plan?.totalStake).toBeCloseTo(100, 2);
    expect(plan?.positions.some((position) => position.kind === "straight")).toBe(
      true,
    );
    expect(plan?.positions.some((position) => position.kind === "parlay")).toBe(
      true,
    );
  });

  it("builds a useful 2.5x plan instead of failing low payout targets", () => {
    const plan = buildPortfolioPlan(markets, {
      amount: 100,
      targetPayout: 250,
      risk: "balanced",
      platform: "either",
      live: "pregame",
      mode: "multi_game",
      maxLegs: 6,
    });

    expect(plan).not.toBeNull();
    expect(plan?.totalStake).toBeCloseTo(100, 2);
    expect(
      Math.abs((plan?.allWinPayout ?? 0) - 250) / 250,
    ).toBeLessThanOrEqual(0.2);
  });

  it("keeps any one position inside the configured balanced risk cap", () => {
    const plan = buildPortfolioPlan(markets, {
      amount: 250,
      targetPayout: 700,
      risk: "balanced",
      platform: "either",
      live: "pregame",
      mode: "multi_game",
      maxLegs: 6,
    });

    expect(plan).not.toBeNull();
    expect(plan?.maxPositionShare ?? 1).toBeLessThanOrEqual(0.341);
  });

  it("uses more high-variance upside when the requested payout is higher", () => {
    const lowerTarget = buildPortfolioPlan(markets, {
      amount: 100,
      targetPayout: 180,
      risk: "balanced",
      platform: "either",
      live: "pregame",
      mode: "multi_game",
      maxLegs: 6,
    });
    const higherTarget = buildPortfolioPlan(markets, {
      amount: 100,
      targetPayout: 500,
      risk: "balanced",
      platform: "either",
      live: "pregame",
      mode: "multi_game",
      maxLegs: 8,
    });

    expect(lowerTarget).not.toBeNull();
    expect(higherTarget).not.toBeNull();
    expect(higherTarget!.hailMaryStakeShare).toBeGreaterThan(
      lowerTarget!.hailMaryStakeShare,
    );
  });

  it("keeps the all-win payout reasonably close to the requested target", () => {
    const plan = buildPortfolioPlan(markets, {
      amount: 100,
      targetPayout: 300,
      risk: "balanced",
      platform: "either",
      live: "pregame",
      mode: "multi_game",
      maxLegs: 6,
    });

    expect(plan).not.toBeNull();
    expect(
      Math.abs(plan!.allWinPayout - 300) / 300,
    ).toBeLessThanOrEqual(0.15);
  });

  it("keeps the plan spread across multiple underlying markets", () => {
    const plan = buildPortfolioPlan(markets, {
      amount: 150,
      targetPayout: 400,
      risk: "balanced",
      platform: "either",
      live: "pregame",
      mode: "multi_game",
      maxLegs: 6,
    });

    expect(plan).not.toBeNull();
    const uniqueMarkets = new Set(
      plan!.positions.flatMap((position) =>
        position.legs.map(
          (leg) => leg.canonical?.key ?? leg.platformMarketId,
        ),
      ),
    );

    expect(uniqueMarkets.size).toBeGreaterThanOrEqual(4);
  });

  it("mixes safer straights with a genuinely riskier straight", () => {
    const plan = buildPortfolioPlan(markets, {
      amount: 100,
      targetPayout: 500,
      risk: "balanced",
      platform: "either",
      live: "pregame",
      mode: "multi_game",
      maxLegs: 8,
    });

    expect(plan).not.toBeNull();

    const straightProbabilities = plan!.positions
      .filter((position) => position.kind === "straight")
      .map((position) => position.estimatedProbability);

    expect(
      straightProbabilities.some(
        (probability) => probability >= 0.72,
      ),
    ).toBe(true);
    expect(
      straightProbabilities.some(
        (probability) => probability >= 0.28 && probability <= 0.7,
      ),
    ).toBe(true);
    expect(plan!.riskyStraightStakeShare).toBeGreaterThan(0.1);
  });

  it("adds a small Hail Mary parlay for a higher target without making it the bankroll", () => {
    const plan = buildPortfolioPlan(markets, {
      amount: 100,
      targetPayout: 500,
      risk: "balanced",
      platform: "either",
      live: "pregame",
      mode: "multi_game",
      maxLegs: 8,
    });

    expect(plan).not.toBeNull();

    const hailMary = plan!.positions.find(
      (position) => position.role === "hail_mary",
    );

    expect(hailMary).toBeDefined();
    expect(hailMary!.grossReturn).toBeGreaterThanOrEqual(25);
    expect(plan!.hailMaryStakeShare).toBeGreaterThan(0);
    expect(plan!.hailMaryStakeShare).toBeLessThanOrEqual(0.081);
  });

  it("keeps lower-risk plans from putting most capital into parlays", () => {
    const plan = buildPortfolioPlan(markets, {
      amount: 100,
      targetPayout: 300,
      risk: "lower",
      platform: "either",
      live: "pregame",
      mode: "multi_game",
      maxLegs: 6,
    });

    expect(plan).not.toBeNull();
    expect(plan!.parlayStakeShare).toBeLessThanOrEqual(0.421);
    expect(plan!.straightStakeShare).toBeGreaterThan(plan!.parlayStakeShare);
  });

  it("caps one-game portfolios at three bets without repeated players except yards plus TD", () => {
    const oneGameMarkets = [
      playerProp("PUKA-YDS", "Puka Nacua", "receiving_yards", 5_800, 6_900),
      playerProp("PUKA-TD", "Puka Nacua", "touchdowns", 3_800, 4_900),
      playerProp("PUKA-REC", "Puka Nacua", "receptions", 5_400, 6_500),
      playerProp("STAFFORD-PASS", "Matthew Stafford", "passing_yards", 6_100, 7_100),
      playerProp("KYREN-RUSH", "Kyren Williams", "rushing_yards", 5_700, 6_700),
      playerProp("KYREN-TD", "Kyren Williams", "touchdowns", 4_500, 5_500),
      playerProp("NABERS-YDS", "Malik Nabers", "receiving_yards", 5_300, 6_400),
      playerProp("DART-PASS", "Jaxson Dart", "passing_yards", 5_500, 6_600),
    ];

    const plan = buildPortfolioPlan(oneGameMarkets, {
      amount: 100,
      targetPayout: 250,
      risk: "balanced",
      platform: "either",
      live: "pregame",
      mode: "sgp",
      maxLegs: 4,
      singleGame: true,
      maxPositions: 3,
    });

    expect(plan).not.toBeNull();
    expect(plan!.positions.length).toBeLessThanOrEqual(3);

    const legs = plan!.positions.flatMap((position) => position.legs);
    for (let firstIndex = 0; firstIndex < legs.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < legs.length; secondIndex += 1) {
        const first = legs[firstIndex]!;
        const second = legs[secondIndex]!;
        if (first.canonical?.subject !== second.canonical?.subject) continue;
        if (first.canonical?.key === second.canonical?.key) {
          throw new Error("one-game portfolio repeated the exact same market");
        }

        const yardage = new Set([
          "passing_yards",
          "rushing_yards",
          "receiving_yards",
        ]);
        const touchdowns = new Set(["touchdowns"]);
        const firstFamily = first.canonical?.family ?? "other";
        const secondFamily = second.canonical?.family ?? "other";
        expect(
          (yardage.has(firstFamily) && touchdowns.has(secondFamily)) ||
            (touchdowns.has(firstFamily) && yardage.has(secondFamily)),
        ).toBe(true);
      }
    }
  });
});
