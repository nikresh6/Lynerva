import type { MarketOpportunity, Platform } from "@/lib/markets/types";

export interface BuilderOptions {
  minReturn: number;
  maxReturn: number;
  maxLegs: number;
  platform: "either" | Platform;
  live: "all" | "pregame" | "live";
  excludeSameGame: boolean;
}

export interface BuiltCombination {
  legs: MarketOpportunity[];
  grossReturn: number;
  estimatedProbability: number;
  impliedProbability: number;
  estimatedEdge: number;
  correlationWarning: boolean;
  executableAsSingleContract: false;
  relaxedConstraints: string[];
}

function gameKey(market: MarketOpportunity) {
  return market.canonical?.matchup ?? market.eventTitle.toLowerCase();
}

export function buildCombination(
  opportunities: MarketOpportunity[],
  options: BuilderOptions,
): BuiltCombination | null {
  const ranked = opportunities
    .filter((market) => {
      if (
        market.executablePriceBps === null ||
        market.executablePriceBps <= 0 ||
        market.executablePriceBps >= 10_000 ||
        market.recommendedProbabilityBps === null ||
        !market.canonical
      ) return false;
      if ((market.edgeBps ?? 0) <= 0 || market.freshness === "stale") return false;
      if (options.platform !== "either" && market.platform !== options.platform) return false;
      if (options.live === "live" && !market.isLive) return false;
      if (options.live === "pregame" && market.isLive) return false;
      return true;
    })
    .toSorted(
      (a, b) =>
        (b.opportunityScore ?? -Infinity) -
        (a.opportunityScore ?? -Infinity),
    );

  const eligible: MarketOpportunity[] = [];
  const perGame = new Map<string, number>();
  for (const market of ranked) {
    const key = gameKey(market);
    const count = perGame.get(key) ?? 0;
    if (count >= 3) continue;
    eligible.push(market);
    perGame.set(key, count + 1);
    if (eligible.length >= 24) break;
  }

  let best: BuiltCombination | null = null;
  const visit = (start: number, legs: MarketOpportunity[]) => {
    if (legs.length > 0) {
      const priceProduct = legs.reduce(
        (product, leg) => product * ((leg.executablePriceBps ?? 10_000) / 10_000),
        1,
      );
      const grossReturn = 1 / priceProduct;
      if (grossReturn > options.maxReturn * 1.2) return;
      if (grossReturn >= options.minReturn && grossReturn <= options.maxReturn) {
        const probability = legs.reduce(
          (product, leg) => product * ((leg.recommendedProbabilityBps ?? 0) / 10_000),
          1,
        );
        const score = probability - priceProduct;
        if (!best || score > best.estimatedEdge) {
          const keys = legs.map(gameKey);
          best = {
            legs: [...legs],
            grossReturn,
            estimatedProbability: probability,
            impliedProbability: priceProduct,
            estimatedEdge: score,
            correlationWarning: new Set(keys).size !== keys.length,
            executableAsSingleContract: false,
            relaxedConstraints: [],
          };
        }
      }
    }
    if (legs.length >= options.maxLegs) return;
    for (let index = start; index < eligible.length; index += 1) {
      const candidate = eligible[index];
      if (!candidate) continue;
      if (
        legs.some(
          (leg) =>
            leg.canonical?.key === candidate.canonical?.key ||
            (leg.platform === candidate.platform &&
              leg.platformMarketId === candidate.platformMarketId),
        )
      ) {
        continue;
      }
      if (
        options.excludeSameGame &&
        legs.some((leg) => gameKey(leg) === gameKey(candidate))
      ) {
        continue;
      }
      visit(index + 1, [...legs, candidate]);
    }
  };
  visit(0, []);
  return best;
}


export function buildBestAvailableCombination(
  opportunities: MarketOpportunity[],
  options: BuilderOptions,
): BuiltCombination | null {
  const strict = buildCombination(opportunities, options);
  if (strict) return strict;

  if (options.live !== "all") {
    const withAllStates = buildCombination(opportunities, {
      ...options,
      live: "all",
    });
    if (withAllStates) {
      return {
        ...withAllStates,
        relaxedConstraints: ["Included both pregame and live markets because the requested state had no valid combination."],
      };
    }
  }

  if (options.excludeSameGame) {
    const withSameGame = buildCombination(opportunities, {
      ...options,
      live: "all",
      excludeSameGame: false,
    });
    if (withSameGame) {
      return {
        ...withSameGame,
        correlationWarning: true,
        relaxedConstraints: [
          ...(options.live !== "all"
            ? ["Included both pregame and live markets because the requested state had no valid combination."]
            : []),
          "Allowed same-game legs because no cross-game combination fit the target return.",
        ],
      };
    }
  }

  return null;
}
