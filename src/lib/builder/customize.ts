import type { MarketOpportunity } from "@/lib/markets/types";
import { clamp } from "@/lib/utils";
import {
  buildCombinationCandidates,
  type BuilderMode,
  type BuiltCombination,
} from "./index";
import type {
  PortfolioPlan,
  PortfolioPosition,
  PortfolioRole,
} from "./portfolio";

export type ReplacementDirection =
  | "any"
  | "same"
  | "over"
  | "under"
  | "moneyline";

export interface MarketReplacementOptions {
  direction: ReplacementDirection;
  toleranceBps: number;
  existingLegs?: MarketOpportunity[];
  mode?: BuilderMode;
  limit?: number;
}

function marketIdentity(market: MarketOpportunity) {
  return (
    market.canonical?.key ??
    `${market.platform}:${market.platformMarketId}:${market.recommendedSide}`
  );
}

function playerStatIdentity(market: MarketOpportunity) {
  const canonical = market.canonical;
  if (!canonical) return marketIdentity(market);
  return [
    canonical.matchup ?? market.eventTitle.toLowerCase(),
    canonical.subject.toLowerCase(),
    canonical.family,
  ].join("|");
}

export function builderPickDirection(market: MarketOpportunity) {
  const canonical = market.canonical;
  if (!canonical) return market.recommendedSide ?? "yes";
  if (canonical.family === "moneyline") return "moneyline";
  if (market.recommendedSide !== "no") return canonical.direction;
  if (canonical.direction === "over") return "under";
  if (canonical.direction === "under") return "over";
  if (canonical.direction === "yes") return "no";
  if (canonical.direction === "no") return "yes";
  return canonical.direction;
}

function directionMatches(
  market: MarketOpportunity,
  target: MarketOpportunity,
  direction: ReplacementDirection,
) {
  if (direction === "any") return true;
  if (direction === "same") {
    return builderPickDirection(market) === builderPickDirection(target);
  }
  if (direction === "moneyline") {
    return market.canonical?.family === "moneyline";
  }
  return builderPickDirection(market) === direction;
}

function structurallyCompatible(
  candidate: MarketOpportunity,
  existingLegs: MarketOpportunity[],
  mode: BuilderMode,
) {
  if (
    existingLegs.some(
      (leg) =>
        marketIdentity(leg) === marketIdentity(candidate) ||
        playerStatIdentity(leg) === playerStatIdentity(candidate),
    )
  ) {
    return false;
  }

  const matchup = candidate.canonical?.matchup ?? candidate.eventTitle;
  if (mode === "multi_game") {
    return !existingLegs.some(
      (leg) => (leg.canonical?.matchup ?? leg.eventTitle) === matchup,
    );
  }

  if (mode === "sgp" && existingLegs.length) {
    const first = existingLegs[0]!;
    return (
      (first.canonical?.matchup ?? first.eventTitle) === matchup &&
      first.platform === candidate.platform
    );
  }

  return true;
}

export function findMarketReplacements(
  markets: MarketOpportunity[],
  target: MarketOpportunity,
  options: MarketReplacementOptions,
) {
  const targetPrice = target.executablePriceBps ?? 5_000;
  const existingLegs = options.existingLegs ?? [];
  const mode = options.mode ?? "any";
  const limit = options.limit ?? 10;
  const tolerance = Math.max(0, options.toleranceBps);

  return markets
    .filter((market) => {
      if (
        marketIdentity(market) === marketIdentity(target) ||
        market.executablePriceBps === null ||
        market.recommendedProbabilityBps === null ||
        market.executablePriceBps <= 0 ||
        market.executablePriceBps >= 10_000 ||
        market.freshness === "stale" ||
        (market.edgeBps ?? 0) <= 0
      ) {
        return false;
      }
      if (market.platform !== target.platform) return false;
      if (market.isLive !== target.isLive) return false;
      if (!directionMatches(market, target, options.direction)) return false;
      if (
        Math.abs(market.executablePriceBps - targetPrice) > tolerance
      ) {
        return false;
      }
      return structurallyCompatible(market, existingLegs, mode);
    })
    .map((market) => {
      const priceDistance =
        Math.abs((market.executablePriceBps ?? targetPrice) - targetPrice) /
        100;
      const score = market.lynervaScore ?? 50;
      const edge = (market.edgeBps ?? 0) / 100;
      const reliability = market.model.reliabilityBps / 100;
      const utility =
        score + 0.38 * edge + 0.05 * reliability - 0.72 * priceDistance;
      return { market, utility, priceDistance };
    })
    .toSorted(
      (first, second) =>
        second.utility - first.utility ||
        first.priceDistance - second.priceDistance ||
        (second.market.lynervaScore ?? 0) - (first.market.lynervaScore ?? 0),
    )
    .slice(0, limit)
    .map((row) => row.market);
}

function oddsShape(legs: MarketOpportunity[]) {
  const contributions = legs.map((leg) =>
    -Math.log(Math.max((leg.executablePriceBps ?? 1) / 10_000, 0.001)),
  );
  const total = contributions.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return { maxShare: 1, balanceScore: 0 };
  const shares = contributions.map((value) => value / total);
  const maxShare = Math.max(...shares);
  const ideal = 1 / Math.max(legs.length, 1);
  const deviation =
    shares.reduce((sum, share) => sum + Math.abs(share - ideal), 0) / 2;
  return {
    maxShare,
    balanceScore: clamp(1 - deviation, 0, 1),
  };
}

export function rebuildCombinationFromLegs(
  legs: MarketOpportunity[],
): BuiltCombination | null {
  if (legs.length < 2) return null;
  if (
    legs.some(
      (leg) =>
        leg.executablePriceBps === null ||
        leg.recommendedProbabilityBps === null ||
        leg.executablePriceBps <= 0 ||
        leg.executablePriceBps >= 10_000,
    )
  ) {
    return null;
  }

  const priceProduct = legs.reduce(
    (product, leg) => product * ((leg.executablePriceBps ?? 1) / 10_000),
    1,
  );
  const probabilityProduct = legs.reduce(
    (product, leg) =>
      product * clamp((leg.recommendedProbabilityBps ?? 1) / 10_000, 0.001, 0.999),
    1,
  );
  const grossReturn = 1 / priceProduct;
  const expectedValueMultiplier = probabilityProduct * grossReturn;
  const { maxShare, balanceScore } = oddsShape(legs);

  const legScores = legs
    .map((leg) => leg.lynervaScore)
    .filter((score): score is number => score !== null);
  const averageLegScore = legScores.length
    ? legScores.reduce((sum, score) => sum + score, 0) / legScores.length
    : 50;
  const valueQuality = clamp(
    50 + (expectedValueMultiplier - 1) * 150,
    0,
    100,
  );
  const hitQuality = clamp(probabilityProduct * 130, 0, 100);
  const familyDiversity = clamp(
    new Set(legs.map((leg) => leg.canonical?.family ?? "other")).size /
      Math.min(legs.length, 5),
    0,
    1,
  );
  const lynervaScore = Math.round(
    clamp(
      0.48 * averageLegScore +
        0.24 * valueQuality +
        0.12 * balanceScore * 100 +
        0.08 * hitQuality +
        0.08 * familyDiversity * 100,
      0,
      100,
    ),
  );

  const matchups = legs.map(
    (leg) => leg.canonical?.matchup ?? leg.eventTitle.toLowerCase(),
  );

  return {
    legs,
    grossReturn,
    estimatedProbability: probabilityProduct,
    rawModelProbability: probabilityProduct,
    impliedProbability: priceProduct,
    estimatedEdge: probabilityProduct - priceProduct,
    expectedValueMultiplier,
    expectedProfitOn100: (expectedValueMultiplier - 1) * 100,
    correlationWarning: new Set(matchups).size !== matchups.length,
    executableAsSingleContract: false,
    relaxedConstraints: [],
    maxOddsContributionShare: maxShare,
    balanceScore,
    lynervaScore,
  };
}

function rebuildPosition(
  position: PortfolioPosition,
  legs: MarketOpportunity[],
): PortfolioPosition | null {
  if (!legs.length) return null;

  if (position.kind === "straight") {
    const market = legs[0]!;
    if (
      market.executablePriceBps === null ||
      market.recommendedProbabilityBps === null ||
      market.executablePriceBps <= 0
    ) {
      return null;
    }
    const grossReturn = 10_000 / market.executablePriceBps;
    const probability = market.recommendedProbabilityBps / 10_000;
    const expectedValueMultiplier = probability * grossReturn;
    return {
      ...position,
      id: `straight:${marketIdentity(market)}`,
      grossReturn,
      estimatedProbability: probability,
      expectedValueMultiplier,
      expectedProfit: position.stake * (expectedValueMultiplier - 1),
      payoutIfWin: position.stake * grossReturn,
      lynervaScore: market.lynervaScore ?? 50,
      legs: [market],
      parlayMode: null,
    };
  }

  const combination = rebuildCombinationFromLegs(legs);
  if (!combination) return null;
  return {
    ...position,
    id: `parlay:${legs.map(marketIdentity).toSorted().join("+")}`,
    grossReturn: combination.grossReturn,
    estimatedProbability: combination.estimatedProbability,
    expectedValueMultiplier: combination.expectedValueMultiplier,
    expectedProfit:
      position.stake * (combination.expectedValueMultiplier - 1),
    payoutIfWin: position.stake * combination.grossReturn,
    lynervaScore: combination.lynervaScore,
    legs,
  };
}

export function replacePortfolioLeg(
  plan: PortfolioPlan,
  positionIndex: number,
  legIndex: number,
  replacement: MarketOpportunity,
) {
  const position = plan.positions[positionIndex];
  if (!position) return plan;
  const nextLegs = [...position.legs];
  nextLegs[legIndex] = replacement;
  const nextPosition = rebuildPosition(position, nextLegs);
  if (!nextPosition) return plan;
  const positions = [...plan.positions];
  positions[positionIndex] = nextPosition;
  return rebuildPortfolioPlan(plan, positions);
}

export function replacePortfolioPosition(
  plan: PortfolioPlan,
  positionIndex: number,
  replacement:
    | { kind: "straight"; market: MarketOpportunity }
    | { kind: "parlay"; combination: BuiltCombination },
) {
  const position = plan.positions[positionIndex];
  if (!position) return plan;

  const nextPosition =
    replacement.kind === "straight"
      ? rebuildPosition(position, [replacement.market])
      : rebuildPosition(position, replacement.combination.legs);
  if (!nextPosition) return plan;

  const positions = [...plan.positions];
  positions[positionIndex] = nextPosition;
  return rebuildPortfolioPlan(plan, positions);
}

export function rebuildPortfolioPlan(
  plan: PortfolioPlan,
  positions: PortfolioPosition[],
): PortfolioPlan {
  const totalStake = positions.reduce((sum, position) => sum + position.stake, 0);
  const allWinPayout = positions.reduce(
    (sum, position) => sum + position.payoutIfWin,
    0,
  );
  const expectedPayout = positions.reduce(
    (sum, position) =>
      sum +
      position.stake *
        position.estimatedProbability *
        position.grossReturn,
    0,
  );
  const parlayStake = positions
    .filter((position) => position.kind === "parlay")
    .reduce((sum, position) => sum + position.stake, 0);
  const hailMaryStake = positions
    .filter((position) => position.role === "hail_mary")
    .reduce((sum, position) => sum + position.stake, 0);
  const riskyStraightStake = positions
    .filter(
      (position) =>
        position.role === "value_straight" ||
        position.role === "aggressive_straight",
    )
    .reduce((sum, position) => sum + position.stake, 0);
  const maxStake = Math.max(...positions.map((position) => position.stake), 0);

  return {
    ...plan,
    positions,
    totalStake,
    allWinPayout,
    expectedPayout,
    expectedProfit: expectedPayout - totalStake,
    straightStakeShare:
      1 - parlayStake / Math.max(totalStake, 0.01),
    parlayStakeShare: parlayStake / Math.max(totalStake, 0.01),
    hailMaryStakeShare: hailMaryStake / Math.max(totalStake, 0.01),
    riskyStraightStakeShare:
      riskyStraightStake / Math.max(totalStake, 0.01),
    maxPositionShare: maxStake / Math.max(totalStake, 0.01),
    averagePositionProbability:
      positions.reduce(
        (sum, position) => sum + position.estimatedProbability,
        0,
      ) / Math.max(positions.length, 1),
  };
}

export function findPortfolioBetReplacements(
  markets: MarketOpportunity[],
  position: PortfolioPosition,
  options: {
    direction: ReplacementDirection;
    toleranceBps: number;
    mode: BuilderMode;
    live: "all" | "pregame" | "live";
    existingPositions: PortfolioPosition[];
    limit?: number;
  },
) {
  const excludedLegs = options.existingPositions.flatMap((row) => row.legs);
  const limit = options.limit ?? 8;

  if (position.kind === "straight") {
    const target = position.legs[0];
    if (!target) return [] as Array<
      | { kind: "straight"; market: MarketOpportunity }
      | { kind: "parlay"; combination: BuiltCombination }
    >;
    return findMarketReplacements(markets, target, {
      direction: options.direction,
      toleranceBps: options.toleranceBps,
      existingLegs: excludedLegs.filter(
        (leg) => marketIdentity(leg) !== marketIdentity(target),
      ),
      mode: "any",
      limit,
    }).map((market) => ({ kind: "straight" as const, market }));
  }

  const targetReturn = Math.max(position.grossReturn, 1.05);
  const filteredMarkets = markets.filter((market) => {
    if (!directionMatches(market, position.legs[0] ?? market, options.direction)) {
      return false;
    }
    return !excludedLegs.some(
      (leg) =>
        !position.legs.some(
          (current) => marketIdentity(current) === marketIdentity(leg),
        ) && marketIdentity(leg) === marketIdentity(market),
    );
  });

  const candidates = buildCombinationCandidates(
    filteredMarkets,
    {
      minReturn: Math.max(1.3, targetReturn * 0.72),
      maxReturn: Math.min(500, targetReturn * 1.38),
      maxLegs: Math.max(2, position.legs.length),
      platform: "kalshi",
      live: options.live,
      mode: position.parlayMode ?? options.mode,
      objective: "balanced",
    },
    40,
  )
    .filter((combination) => combination.legs.length === position.legs.length)
    .filter((combination) => {
      const currentIds = new Set(position.legs.map(marketIdentity));
      return combination.legs.some(
        (leg) => !currentIds.has(marketIdentity(leg)),
      );
    })
    .toSorted((first, second) => {
      const firstDistance = Math.abs(
        Math.log(first.grossReturn / targetReturn),
      );
      const secondDistance = Math.abs(
        Math.log(second.grossReturn / targetReturn),
      );
      return (
        firstDistance - secondDistance ||
        second.lynervaScore - first.lynervaScore
      );
    })
    .slice(0, limit);

  return candidates.map((combination) => ({
    kind: "parlay" as const,
    combination,
  }));
}

export function portfolioRoleForReplacement(
  role: PortfolioRole,
  replacementKind: "straight" | "parlay",
) {
  if (replacementKind === "straight") {
    if (role === "core_straight" || role === "value_straight" || role === "aggressive_straight") {
      return role;
    }
    return "value_straight" as const;
  }
  if (role === "core_parlay" || role === "upside_parlay" || role === "hail_mary") {
    return role;
  }
  return "core_parlay" as const;
}
