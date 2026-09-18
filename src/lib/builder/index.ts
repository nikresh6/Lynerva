import type { MarketOpportunity, Platform } from "@/lib/markets/types";
import { clamp } from "@/lib/utils";

export type BuilderMode = "multi_game" | "sgp" | "any";
export type BuilderObjective = "balanced" | "safer" | "max_ev";

export interface BuilderOptions {
  minReturn: number;
  maxReturn: number;
  maxLegs: number;
  platform: "either" | Platform;
  live: "all" | "pregame" | "live";
  mode: BuilderMode;
  objective: BuilderObjective;
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
  maxOddsContributionShare: number;
  balanceScore: number;
}

interface RankedCandidate {
  market: MarketOpportunity;
  price: number;
  modelProbability: number;
  adjustedProbability: number;
  valueMultiplier: number;
  edge: number;
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

  return clamp(price + reliability * (model - price), 0.001, 0.999);
}

function oddsContributionShares(legs: RankedCandidate[]) {
  const contributions = legs.map((leg) => -Math.log(Math.max(leg.price, 0.001)));
  const total = contributions.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return { maxShare: 1, balanceScore: 0 };

  const shares = contributions.map((value) => value / total);
  const maxShare = Math.max(...shares);
  const ideal = 1 / Math.max(legs.length, 1);
  const deviation =
    shares.reduce((sum, share) => sum + Math.abs(share - ideal), 0) / 2;
  const balanceScore = clamp(1 - deviation, 0, 1);

  return { maxShare, balanceScore };
}

function maxAllowedOddsContribution(legCount: number) {
  if (legCount <= 2) return 0.72;
  if (legCount === 3) return 0.58;
  if (legCount === 4) return 0.48;
  if (legCount === 5) return 0.42;
  return 0.38;
}

function preferredOddsContribution(legCount: number) {
  if (legCount <= 2) return 0.6;
  if (legCount === 3) return 0.48;
  if (legCount === 4) return 0.39;
  if (legCount === 5) return 0.34;
  return 0.3;
}

function hasExceptionalLongshotValue(legs: RankedCandidate[]) {
  const totalContribution = legs.reduce(
    (sum, leg) => sum - Math.log(Math.max(leg.price, 0.001)),
    0,
  );
  const largest = legs
    .map((leg) => ({
      leg,
      share:
        -Math.log(Math.max(leg.price, 0.001)) /
        Math.max(totalContribution, 0.0001),
    }))
    .toSorted((a, b) => b.share - a.share)[0];

  if (!largest) return false;

  const reliability = clamp(
    largest.leg.market.model.reliabilityBps / 10_000,
    0,
    1,
  );

  return (
    largest.leg.valueMultiplier >= 1.8 &&
    largest.leg.edge >= 0.12 &&
    reliability >= 0.7
  );
}

function isAcceptablePayoutShape(legs: RankedCandidate[]) {
  const { maxShare } = oddsContributionShares(legs);
  const normalLimit = maxAllowedOddsContribution(legs.length);

  if (maxShare <= normalLimit) return true;
  if (!hasExceptionalLongshotValue(legs)) return false;

  const exceptionalCeiling =
    legs.length <= 2 ? 0.9 : legs.length === 3 ? 0.8 : 0.68;
  return maxShare <= exceptionalCeiling;
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
      const edge = adjustedProbability - price;

      if (valueMultiplier <= 1) return [];

      const searchScore =
        0.8 * Math.log(valueMultiplier) +
        0.55 * Math.log(adjustedProbability) +
        0.15 * edge;

      return [
        {
          market,
          price,
          modelProbability,
          adjustedProbability,
          valueMultiplier,
          edge,
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

  const perPlayerStat = new Map<string, number>();
  const perGame = new Map<string, number>();
  const selected: RankedCandidate[] = [];

  for (const candidate of ranked) {
    const statKey = playerStatKey(candidate.market);
    const statCount = perPlayerStat.get(statKey) ?? 0;
    if (statCount >= 2) continue;

    const key = gameKey(candidate.market);
    const gameCount = perGame.get(key) ?? 0;
    if (gameCount >= 22) continue;

    selected.push(candidate);
    perPlayerStat.set(statKey, statCount + 1);
    perGame.set(key, gameCount + 1);
    if (selected.length >= 140) break;
  }

  return selected;
}

function buildFromState(state: SearchState): BuiltCombination {
  const markets = state.legs.map((candidate) => candidate.market);
  const keys = markets.map(gameKey);
  const grossReturn = 1 / state.priceProduct;
  const expectedValueMultiplier =
    state.probabilityProduct * grossReturn;
  const { maxShare, balanceScore } = oddsContributionShares(state.legs);

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
    maxOddsContributionShare: maxShare,
    balanceScore,
  };
}

function combinationScore(
  combination: BuiltCombination,
  targetReturn: number,
  objective: BuilderObjective,
) {
  const hit = Math.log(Math.max(combination.estimatedProbability, 1e-12));
  const ev = Math.log(Math.max(combination.expectedValueMultiplier, 1e-12));
  const edgeRatio =
    combination.estimatedEdge / Math.max(combination.impliedProbability, 0.01);
  const returnDistance = Math.abs(
    Math.log(Math.max(combination.grossReturn, 1) / targetReturn),
  );
  const preferredShare = preferredOddsContribution(combination.legs.length);
  const concentration = Math.max(
    0,
    combination.maxOddsContributionShare - preferredShare,
  );

  if (objective === "safer") {
    return (
      1.35 * hit +
      0.35 * ev +
      0.08 * edgeRatio -
      0.12 * returnDistance -
      2.4 * concentration +
      0.1 * combination.balanceScore
    );
  }

  if (objective === "max_ev") {
    return (
      0.6 * hit +
      1.25 * ev +
      0.18 * edgeRatio -
      0.08 * returnDistance -
      1.7 * concentration +
      0.06 * combination.balanceScore
    );
  }

  return (
    1.0 * hit +
    0.72 * ev +
    0.12 * edgeRatio -
    0.16 * returnDistance -
    2.8 * concentration +
    0.14 * combination.balanceScore
  );
}

function isBetterCombination(
  candidate: BuiltCombination,
  best: BuiltCombination | null,
  targetReturn: number,
  objective: BuilderObjective,
) {
  if (!best) return true;

  const candidateScore = combinationScore(candidate, targetReturn, objective);
  const bestScore = combinationScore(best, targetReturn, objective);

  if (Math.abs(candidateScore - bestScore) > 0.0001) {
    return candidateScore > bestScore;
  }

  if (candidate.expectedValueMultiplier !== best.expectedValueMultiplier) {
    return candidate.expectedValueMultiplier > best.expectedValueMultiplier;
  }

  return candidate.estimatedProbability > best.estimatedProbability;
}

function stateSearchValue(
  state: SearchState,
  targetReturn: number,
  objective: BuilderObjective,
) {
  const grossReturn = 1 / state.priceProduct;
  const returnDistance = Math.abs(
    Math.log(Math.max(grossReturn, 1) / targetReturn),
  );
  const expectedValueMultiplier =
    state.probabilityProduct / state.priceProduct;
  const { maxShare, balanceScore } = oddsContributionShares(state.legs);
  const preferredShare = preferredOddsContribution(state.legs.length);
  const concentration = Math.max(0, maxShare - preferredShare);

  const probabilityWeight =
    objective === "safer" ? 1.25 : objective === "max_ev" ? 0.6 : 0.95;
  const evWeight =
    objective === "max_ev" ? 1.1 : objective === "safer" ? 0.35 : 0.65;

  return (
    probabilityWeight *
      Math.log(Math.max(state.probabilityProduct, 1e-12)) +
    evWeight * Math.log(Math.max(expectedValueMultiplier, 1e-12)) -
    0.12 * returnDistance -
    1.8 * concentration +
    0.1 * balanceScore
  );
}

function modeCompatible(
  state: SearchState,
  candidate: RankedCandidate,
  mode: BuilderMode,
) {
  if (state.legs.length === 0) return true;

  const first = state.legs[0];
  if (!first) return true;

  const sameGame = gameKey(first.market) === gameKey(candidate.market);

  if (mode === "multi_game") {
    return !state.legs.some(
      (leg) => gameKey(leg.market) === gameKey(candidate.market),
    );
  }

  if (mode === "sgp") {
    return sameGame && first.market.platform === candidate.market.platform;
  }

  return true;
}

function searchCombinations(
  opportunities: MarketOpportunity[],
  options: BuilderOptions,
  resultLimit: number,
): BuiltCombination[] {
  if (
    !Number.isFinite(options.minReturn) ||
    !Number.isFinite(options.maxReturn) ||
    options.minReturn <= 1 ||
    options.maxReturn < options.minReturn ||
    options.maxLegs < 2
  ) {
    return [];
  }

  const eligible = candidatePool(opportunities, options);
  if (eligible.length === 0) return [];

  const targetReturn = Math.sqrt(options.minReturn * options.maxReturn);
  const beamWidth = resultLimit > 1 ? 2_200 : 3_000;
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
  const bestByReturnBucket = new Map<number, BuiltCombination[]>();

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

        if (
          state.legs.some(
            (leg) =>
              playerStatKey(leg.market) === playerStatKey(candidate.market),
          )
        ) {
          continue;
        }

        if (!modeCompatible(state, candidate, options.mode)) {
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
          nextState.legs.length >= 2 &&
          grossReturn >= options.minReturn &&
          grossReturn <= options.maxReturn &&
          isAcceptablePayoutShape(nextState.legs)
        ) {
          const built = buildFromState(nextState);

          if (
            isBetterCombination(
              built,
              best,
              targetReturn,
              options.objective,
            )
          ) {
            best = built;
          }

          if (resultLimit > 1) {
            const bucket = Math.floor(Math.log(grossReturn) / 0.24);
            const bucketTarget = Math.exp((bucket + 0.5) * 0.24);
            const rows = bestByReturnBucket.get(bucket) ?? [];
            const key = built.legs
              .map(
                (leg) =>
                  leg.canonical?.key ??
                  `${leg.platform}:${leg.platformMarketId}`,
              )
              .toSorted()
              .join("|");

            const nextRows = [
              ...rows.filter((row) => {
                const rowKey = row.legs
                  .map(
                    (leg) =>
                      leg.canonical?.key ??
                      `${leg.platform}:${leg.platformMarketId}`,
                  )
                  .toSorted()
                  .join("|");
                return rowKey !== key;
              }),
              built,
            ]
              .toSorted(
                (first, second) =>
                  combinationScore(
                    second,
                    bucketTarget,
                    options.objective,
                  ) -
                  combinationScore(
                    first,
                    bucketTarget,
                    options.objective,
                  ),
              )
              .slice(0, 3);

            bestByReturnBucket.set(bucket, nextRows);
          }
        }

        const searchCeiling =
          resultLimit > 1 ? options.maxReturn : options.minReturn;
        if (depth < options.maxLegs && grossReturn < searchCeiling) {
          next.push(nextState);
        }
      }
    }

    if (next.length === 0) break;

    const buckets = new Map<number, SearchState[]>();
    for (const state of next) {
      const grossReturn = 1 / state.priceProduct;
      const bucket = Math.floor(Math.log(grossReturn) / 0.07);
      const rows = buckets.get(bucket) ?? [];
      rows.push(state);
      buckets.set(bucket, rows);
    }

    frontier = [...buckets.values()]
      .flatMap((rows) =>
        rows
          .toSorted(
            (first, second) =>
              stateSearchValue(second, targetReturn, options.objective) -
              stateSearchValue(first, targetReturn, options.objective),
          )
          .slice(0, resultLimit > 1 ? 72 : 96),
      )
      .toSorted(
        (first, second) =>
          stateSearchValue(second, targetReturn, options.objective) -
          stateSearchValue(first, targetReturn, options.objective),
      )
      .slice(0, beamWidth);
  }

  if (!best) return [];
  if (resultLimit <= 1) return [best];

  const unique = new Map<string, BuiltCombination>();
  const bucketEntries = [...bestByReturnBucket.entries()].toSorted(
    (first, second) => first[0] - second[0],
  );
  const bucketLeaders = bucketEntries.flatMap(([, rows]) =>
    rows.length ? [rows[0]!] : [],
  );
  const extras = bucketEntries
    .flatMap(([, rows]) => rows.slice(1))
    .toSorted((first, second) => {
      const firstScore = combinationScore(
        first,
        targetReturn,
        options.objective,
      );
      const secondScore = combinationScore(
        second,
        targetReturn,
        options.objective,
      );
      return (
        secondScore - firstScore ||
        second.expectedValueMultiplier - first.expectedValueMultiplier
      );
    });

  for (const combination of [best, ...bucketLeaders, ...extras]) {
    const key = combination.legs
      .map(
        (leg) =>
          leg.canonical?.key ??
          `${leg.platform}:${leg.platformMarketId}`,
      )
      .toSorted()
      .join("|");
    if (!unique.has(key)) unique.set(key, combination);
    if (unique.size >= resultLimit) break;
  }

  return [...unique.values()];
}

export function buildCombination(
  opportunities: MarketOpportunity[],
  options: BuilderOptions,
): BuiltCombination | null {
  return searchCombinations(opportunities, options, 1)[0] ?? null;
}

export function buildCombinationCandidates(
  opportunities: MarketOpportunity[],
  options: BuilderOptions,
  limit = 8,
): BuiltCombination[] {
  return searchCombinations(
    opportunities,
    options,
    Math.max(2, Math.min(limit, 48)),
  );
}

export function buildBestAvailableCombination(
  opportunities: MarketOpportunity[],
  options: BuilderOptions,
): BuiltCombination | null {
  return buildCombination(opportunities, options);
}
