import type { MarketOpportunity, Platform } from "@/lib/markets/types";
import { clamp } from "@/lib/utils";

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
  rawModelProbability: number;
  impliedProbability: number;
  estimatedEdge: number;
  expectedValueMultiplier: number;
  expectedProfitOn100: number;
  correlationWarning: boolean;
  executableAsSingleContract: false;
  relaxedConstraints: string[];
}

interface RankedCandidate {
  market: MarketOpportunity;
  price: number;
  modelProbability: number;
  adjustedProbability: number;
  valueMultiplier: number;
  searchScore: number;
}

interface SearchState {
  legs: RankedCandidate[];
  lastIndex: number;
  priceProduct: number;
  probabilityProduct: number;
  rawModelProbabilityProduct: number;
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

function playerStatKey(market: MarketOpportunity) {
  const canonical = market.canonical;
  if (!canonical) return market.platformMarketId;
  return [
    canonical.matchup ?? market.eventTitle.toLowerCase(),
    canonical.subject.toLowerCase(),
    canonical.family,
  ].join("|");
}

function adjustedLegProbability(market: MarketOpportunity) {
  const price = (market.executablePriceBps ?? 0) / 10_000;
  const model = (market.recommendedProbabilityBps ?? 0) / 10_000;
  const reliability = clamp(market.model.reliabilityBps / 10_000, 0, 1);

  // The builder is deliberately more conservative than the single-leg model.
  // A 60%-reliable model only gets to move 60% of the way from the market
  // probability to Lynerva's raw probability.
  return clamp(price + reliability * (model - price), 0.001, 0.999);
}

function candidatePool(
  opportunities: MarketOpportunity[],
  options: BuilderOptions,
) {
  const ranked: RankedCandidate[] = opportunities
    .flatMap((market) => {
      if (
        market.executablePriceBps === null ||
        market.executablePriceBps <= 0 ||
        market.executablePriceBps >= 10_000 ||
        market.recommendedProbabilityBps === null ||
        !market.canonical
      ) {
        return [];
      }
      if ((market.edgeBps ?? 0) <= 0 || market.freshness === "stale") {
        return [];
      }
      if (
        options.platform !== "either" &&
        market.platform !== options.platform
      ) {
        return [];
      }
      if (options.live === "live" && !market.isLive) return [];
      if (options.live === "pregame" && market.isLive) return [];

      const price = market.executablePriceBps / 10_000;
      const modelProbability = market.recommendedProbabilityBps / 10_000;
      const adjustedProbability = adjustedLegProbability(market);
      const valueMultiplier = adjustedProbability / price;

      if (valueMultiplier <= 1) return [];

      // This score is only for keeping the search set manageable. Final
      // combinations are never ranked by Lynerva Score or by this leg score.
      // It favors legs that are both likely and underpriced.
      const searchScore =
        Math.log(valueMultiplier) + 0.45 * Math.log(adjustedProbability);

      return [
        {
          market,
          price,
          modelProbability,
          adjustedProbability,
          valueMultiplier,
          searchScore,
        },
      ];
    })
    .toSorted(
      (first, second) =>
        second.searchScore - first.searchScore ||
        second.adjustedProbability - first.adjustedProbability ||
        second.valueMultiplier - first.valueMultiplier,
    );

  // Alternate lines for the same player/stat are highly dependent and can
  // otherwise consume the whole candidate pool. Keep only the two strongest
  // variants so the optimizer still has price/return flexibility.
  const perPlayerStat = new Map<string, number>();
  const perGame = new Map<string, number>();
  const selected: RankedCandidate[] = [];
  const perGameLimit = options.excludeSameGame ? 14 : 20;

  for (const candidate of ranked) {
    const statKey = playerStatKey(candidate.market);
    const statCount = perPlayerStat.get(statKey) ?? 0;
    if (statCount >= 2) continue;

    const key = gameKey(candidate.market);
    const gameCount = perGame.get(key) ?? 0;
    if (gameCount >= perGameLimit) continue;

    selected.push(candidate);
    perPlayerStat.set(statKey, statCount + 1);
    perGame.set(key, gameCount + 1);
    if (selected.length >= 120) break;
  }

  return selected;
}

function buildFromState(state: SearchState): BuiltCombination {
  const markets = state.legs.map((candidate) => candidate.market);
  const keys = markets.map(gameKey);
  const grossReturn = 1 / state.priceProduct;
  const expectedValueMultiplier =
    state.probabilityProduct * grossReturn;

  return {
    legs: markets,
    grossReturn,
    estimatedProbability: state.probabilityProduct,
    rawModelProbability: state.rawModelProbabilityProduct,
    impliedProbability: state.priceProduct,
    estimatedEdge: state.probabilityProduct - state.priceProduct,
    expectedValueMultiplier,
    expectedProfitOn100: (expectedValueMultiplier - 1) * 100,
    correlationWarning: new Set(keys).size !== keys.length,
    executableAsSingleContract: false,
    relaxedConstraints: [],
  };
}

function isBetterCombination(
  candidate: BuiltCombination,
  best: BuiltCombination | null,
  targetReturn: number,
) {
  if (!best) return true;

  // Given the user's requested payout range, the first goal is the parlay
  // most likely to hit. Expected value breaks close calls.
  const probabilityDifference =
    candidate.estimatedProbability - best.estimatedProbability;
  if (Math.abs(probabilityDifference) > 0.0005) {
    return probabilityDifference > 0;
  }

  const evDifference =
    candidate.expectedValueMultiplier - best.expectedValueMultiplier;
  if (Math.abs(evDifference) > 0.0025) {
    return evDifference > 0;
  }

  if (candidate.estimatedEdge !== best.estimatedEdge) {
    return candidate.estimatedEdge > best.estimatedEdge;
  }

  return (
    Math.abs(candidate.grossReturn - targetReturn) <
    Math.abs(best.grossReturn - targetReturn)
  );
}

function stateSearchValue(state: SearchState, targetReturn: number) {
  const grossReturn = 1 / state.priceProduct;
  const returnDistance = Math.abs(
    Math.log(Math.max(grossReturn, 1) / targetReturn),
  );
  const expectedValueMultiplier =
    state.probabilityProduct / state.priceProduct;

  return (
    Math.log(Math.max(state.probabilityProduct, 1e-12)) +
    0.35 * Math.log(Math.max(expectedValueMultiplier, 1e-12)) -
    0.12 * returnDistance
  );
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
  const beamWidth = 2_500;
  let frontier: SearchState[] = [
    {
      legs: [],
      lastIndex: -1,
      priceProduct: 1,
      probabilityProduct: 1,
      rawModelProbabilityProduct: 1,
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

        if (
          state.legs.some((leg) =>
            sameContract(leg.market, candidate.market),
          )
        ) {
          continue;
        }

        // Do not pretend alternate lines on the same player/stat are
        // independent parlay legs.
        if (
          state.legs.some(
            (leg) =>
              playerStatKey(leg.market) === playerStatKey(candidate.market),
          )
        ) {
          continue;
        }

        if (
          options.excludeSameGame &&
          state.legs.some(
            (leg) => gameKey(leg.market) === gameKey(candidate.market),
          )
        ) {
          continue;
        }

        const priceProduct = state.priceProduct * candidate.price;
        if (priceProduct <= 0) continue;

        const grossReturn = 1 / priceProduct;
        if (grossReturn > options.maxReturn) {
          continue;
        }

        const nextState: SearchState = {
          legs: [...state.legs, candidate],
          lastIndex: index,
          priceProduct,
          probabilityProduct:
            state.probabilityProduct * candidate.adjustedProbability,
          rawModelProbabilityProduct:
            state.rawModelProbabilityProduct * candidate.modelProbability,
        };

        if (
          grossReturn >= options.minReturn &&
          grossReturn <= options.maxReturn
        ) {
          const built = buildFromState(nextState);
          if (isBetterCombination(built, best, targetReturn)) {
            best = built;
          }
        }

        if (depth < options.maxLegs && grossReturn < options.minReturn) {
          next.push(nextState);
        }
      }
    }

    if (next.length === 0) break;

    // Keep a broad beam across payout levels instead of simply carrying
    // forward the highest individual-score legs.
    const buckets = new Map<number, SearchState[]>();
    for (const state of next) {
      const grossReturn = 1 / state.priceProduct;
      const bucket = Math.floor(Math.log(grossReturn) / 0.08);
      const rows = buckets.get(bucket) ?? [];
      rows.push(state);
      buckets.set(bucket, rows);
    }

    frontier = [...buckets.values()]
      .flatMap((rows) =>
        rows
          .toSorted(
            (first, second) =>
              stateSearchValue(second, targetReturn) -
              stateSearchValue(first, targetReturn),
          )
          .slice(0, 80),
      )
      .toSorted(
        (first, second) =>
          stateSearchValue(second, targetReturn) -
          stateSearchValue(first, targetReturn),
      )
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
