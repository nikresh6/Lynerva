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

function sameContract(first: MarketOpportunity, second: MarketOpportunity) {
  return (
    first.canonical?.key === second.canonical?.key ||
    (first.platform === second.platform &&
      first.platformMarketId === second.platformMarketId)
  );
}

function candidatePool(
  opportunities: MarketOpportunity[],
  options: BuilderOptions,
) {
  const ranked = opportunities
    .filter((market) => {
      if (
        market.executablePriceBps === null ||
        market.executablePriceBps <= 0 ||
        market.executablePriceBps >= 10_000 ||
        market.recommendedProbabilityBps === null ||
        !market.canonical
      ) {
        return false;
      }
      if ((market.edgeBps ?? 0) <= 0 || market.freshness === "stale") {
        return false;
      }
      if (
        options.platform !== "either" &&
        market.platform !== options.platform
      ) {
        return false;
      }
      if (options.live === "live" && !market.isLive) return false;
      if (options.live === "pregame" && market.isLive) return false;
      return true;
    })
    .toSorted(
      (first, second) =>
        (second.opportunityScore ?? -Infinity) -
        (first.opportunityScore ?? -Infinity),
    );

  const selected: MarketOpportunity[] = [];
  const perGame = new Map<string, number>();
  const perGameLimit = options.excludeSameGame ? 6 : 12;

  for (const market of ranked) {
    const key = gameKey(market);
    const count = perGame.get(key) ?? 0;
    if (count >= perGameLimit) continue;
    selected.push(market);
    perGame.set(key, count + 1);
    if (selected.length >= 120) break;
  }

  return selected;
}

interface SearchState {
  legs: MarketOpportunity[];
  lastIndex: number;
  priceProduct: number;
  probabilityProduct: number;
}

function buildFromState(state: SearchState): BuiltCombination {
  const keys = state.legs.map(gameKey);
  return {
    legs: state.legs,
    grossReturn: 1 / state.priceProduct,
    estimatedProbability: state.probabilityProduct,
    impliedProbability: state.priceProduct,
    estimatedEdge: state.probabilityProduct - state.priceProduct,
    correlationWarning: new Set(keys).size !== keys.length,
    executableAsSingleContract: false,
    relaxedConstraints: [],
  };
}

export function buildCombination(
  opportunities: MarketOpportunity[],
  options: BuilderOptions,
): BuiltCombination | null {
  if (
    !Number.isFinite(options.minReturn) ||
    !Number.isFinite(options.maxReturn) ||
    options.minReturn <= 1 ||
    options.maxReturn < options.minReturn ||
    options.maxLegs < 1
  ) {
    return null;
  }

  const eligible = candidatePool(opportunities, options);
  if (eligible.length === 0) return null;

  const targetReturn = Math.sqrt(options.minReturn * options.maxReturn);
  const beamWidth = 600;
  let frontier: SearchState[] = [
    {
      legs: [],
      lastIndex: -1,
      priceProduct: 1,
      probabilityProduct: 1,
    },
  ];
  let best: BuiltCombination | null = null;

  for (let depth = 1; depth <= options.maxLegs; depth += 1) {
    const next: SearchState[] = [];

    for (const state of frontier) {
      for (
        let index = state.lastIndex + 1;
        index < eligible.length;
        index += 1
      ) {
        const candidate = eligible[index];
        if (!candidate) continue;
        if (state.legs.some((leg) => sameContract(leg, candidate))) continue;
        if (
          options.excludeSameGame &&
          state.legs.some((leg) => gameKey(leg) === gameKey(candidate))
        ) {
          continue;
        }

        const price = (candidate.executablePriceBps ?? 10_000) / 10_000;
        const probability =
          (candidate.recommendedProbabilityBps ?? 0) / 10_000;
        const priceProduct = state.priceProduct * price;
        if (priceProduct <= 0) continue;

        const grossReturn = 1 / priceProduct;
        if (grossReturn > options.maxReturn) {
          // Every additional leg only increases gross return, so this branch
          // can never come back into the requested range.
          continue;
        }

        const nextState: SearchState = {
          legs: [...state.legs, candidate],
          lastIndex: index,
          priceProduct,
          probabilityProduct: state.probabilityProduct * probability,
        };

        if (
          grossReturn >= options.minReturn &&
          grossReturn <= options.maxReturn
        ) {
          const built = buildFromState(nextState);
          if (
            !best ||
            built.estimatedEdge > best.estimatedEdge ||
            (built.estimatedEdge === best.estimatedEdge &&
              Math.abs(built.grossReturn - targetReturn) <
                Math.abs(best.grossReturn - targetReturn))
          ) {
            best = built;
          }
        }

        if (depth < options.maxLegs && grossReturn < options.minReturn) {
          next.push(nextState);
        }
      }
    }

    if (next.length === 0) break;

    frontier = next
      .toSorted((first, second) => {
        const firstReturn = 1 / first.priceProduct;
        const secondReturn = 1 / second.priceProduct;
        const firstDistance = Math.abs(
          Math.log(firstReturn / targetReturn),
        );
        const secondDistance = Math.abs(
          Math.log(secondReturn / targetReturn),
        );
        const firstEdge =
          first.probabilityProduct - first.priceProduct;
        const secondEdge =
          second.probabilityProduct - second.priceProduct;

        return (
          firstDistance - secondDistance ||
          secondEdge - firstEdge
        );
      })
      .slice(0, beamWidth);
  }

  return best;
}

export function buildBestAvailableCombination(
  opportunities: MarketOpportunity[],
  options: BuilderOptions,
): BuiltCombination | null {
  return buildCombination(opportunities, options);
}
