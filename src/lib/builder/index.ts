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
  lynervaScore: number;
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

function mutuallyExclusiveMoneylines(
  first: MarketOpportunity,
  second: MarketOpportunity,
) {
  const left = first.canonical;
  const right = second.canonical;
  if (
    left?.family !== "moneyline" ||
    right?.family !== "moneyline" ||
    !left.matchup ||
    left.matchup !== right.matchup ||
    left.subject === right.subject
  ) {
    return false;
  }

  const teams = left.matchup.split("-");
  return teams.includes(left.subject) && teams.includes(right.subject);
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
  // The market probability has already gone through stat-specific modeling and
  // calibration. Builder economics use that calibrated probability directly
  // so a TD or interception is not silently shrunk toward price more than a
  // yardage prop. Reliability is handled separately in ranking/eligibility.
  return clamp(
    (market.recommendedProbabilityBps ?? 0) / 10_000,
    0.001,
    0.999,
  );
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

  // Exceptional value can justify one payout-heavy leg in a short parlay,
  // but it should not dominate a four-plus-leg build. At that point the user
  // asked for a parlay, not three safe legs plus one disguised lottery ticket.
  const exceptionalCeiling =
    legs.length <= 2
      ? 0.9
      : legs.length === 3
        ? 0.72
        : legs.length === 4
          ? 0.52
          : 0.46;
  return maxShare <= exceptionalCeiling;
}

function familyKey(market: MarketOpportunity) {
  return market.canonical?.family ?? "other";
}

function pickDirection(market: MarketOpportunity) {
  const canonical = market.canonical;
  if (!canonical) return market.recommendedSide ?? "yes";
  if (market.recommendedSide !== "no") return canonical.direction;
  if (canonical.direction === "over") return "under";
  if (canonical.direction === "under") return "over";
  if (canonical.direction === "yes") return "no";
  return "yes";
}

function combinationShape(legs: RankedCandidate[]) {
  if (!legs.length) {
    return {
      familyDiversity: 0,
      subjectDiversity: 0,
      normalLegShare: 0,
      directionBalance: 0,
      ultraSafeShare: 0,
    };
  }

  const families = new Set(legs.map((leg) => familyKey(leg.market)));
  const subjects = new Set(
    legs.map((leg) => leg.market.canonical?.subject.toLowerCase() ?? leg.market.platformMarketId),
  );
  const directions = new Map<string, number>();
  let normalLegs = 0;
  let ultraSafeLegs = 0;

  for (const leg of legs) {
    const direction = pickDirection(leg.market);
    directions.set(direction, (directions.get(direction) ?? 0) + 1);
    if (leg.price >= 0.32 && leg.price <= 0.82) normalLegs += 1;
    if (leg.price >= 0.86) ultraSafeLegs += 1;
  }

  const dominantDirection = Math.max(...directions.values()) / legs.length;
  return {
    familyDiversity: clamp(families.size / Math.min(legs.length, 5), 0, 1),
    subjectDiversity: clamp(subjects.size / legs.length, 0, 1),
    normalLegShare: normalLegs / legs.length,
    directionBalance: clamp(1 - Math.max(0, dominantDirection - 0.66) / 0.34, 0, 1),
    ultraSafeShare: ultraSafeLegs / legs.length,
  };
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

      // Prefer real parlay legs over stacks of nearly certain contracts, but do
      // not exclude a strong favorite when the model sees genuine value.
      const normalLegFit = clamp(1 - Math.abs(price - 0.62) / 0.38, 0, 1);
      const reliability = clamp(market.model.reliabilityBps / 10_000, 0, 1);
      const publicScore = clamp((market.lynervaScore ?? 50) / 100, 0, 1);
      const searchScore =
        0.86 * Math.log(valueMultiplier) +
        0.24 * Math.log(adjustedProbability) +
        0.42 * publicScore +
        0.12 * reliability +
        0.10 * edge +
        0.08 * normalLegFit;

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
        second.valueMultiplier - first.valueMultiplier ||
        second.adjustedProbability - first.adjustedProbability,
    );

  // Keep the candidate pool globally quality-ranked. Diversity belongs at the
  // combination level, not in family quotas that can force weaker individual
  // legs into the optimizer.
  const perPlayerStat = new Map<string, number>();
  const perGame = new Map<string, number>();
  const perSubject = new Map<string, number>();
  const selected: RankedCandidate[] = [];

  for (const candidate of ranked) {
    const statKey = playerStatKey(candidate.market);
    if ((perPlayerStat.get(statKey) ?? 0) >= 1) continue;

    const game = gameKey(candidate.market);
    if ((perGame.get(game) ?? 0) >= 40) continue;

    const subject =
      candidate.market.canonical?.subject.toLowerCase() ??
      candidate.market.platformMarketId;
    if ((perSubject.get(subject) ?? 0) >= 7) continue;

    selected.push(candidate);
    perPlayerStat.set(statKey, 1);
    perGame.set(game, (perGame.get(game) ?? 0) + 1);
    perSubject.set(subject, (perSubject.get(subject) ?? 0) + 1);
    if (selected.length >= 220) break;
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
  const legScores = markets
    .map((market) => market.lynervaScore)
    .filter((score): score is number => score !== null);
  const averageLegScore = legScores.length
    ? legScores.reduce((sum, score) => sum + score, 0) / legScores.length
    : 50;
  const valueQuality = clamp(
    50 + (expectedValueMultiplier - 1) * 150,
    0,
    100,
  );
  const hitQuality = clamp(state.probabilityProduct * 130, 0, 100);
  const shape = combinationShape(state.legs);
  const lynervaScore = Math.round(
    clamp(
      0.48 * averageLegScore +
        0.24 * valueQuality +
        0.12 * balanceScore * 100 +
        0.08 * hitQuality +
        0.08 * shape.familyDiversity * 100,
      0,
      100,
    ),
  );

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
    lynervaScore,
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
  const shape = combinationShape(
    combination.legs.map((market) => ({
      market,
      price: (market.executablePriceBps ?? 1) / 10_000,
      modelProbability: (market.recommendedProbabilityBps ?? 1) / 10_000,
      adjustedProbability: adjustedLegProbability(market),
      valueMultiplier:
        adjustedLegProbability(market) /
        Math.max((market.executablePriceBps ?? 1) / 10_000, 0.001),
      edge:
        adjustedLegProbability(market) -
        (market.executablePriceBps ?? 1) / 10_000,
      searchScore: 0,
    })),
  );
  const ultraSafePenalty =
    combination.legs.length >= 4 ? Math.max(0, shape.ultraSafeShare - 0.5) : 0;

  if (objective === "safer") {
    return (
      1.2 * hit +
      0.4 * ev +
      0.08 * edgeRatio -
      0.12 * returnDistance -
      2.4 * concentration +
      0.12 * combination.balanceScore +
      0.12 * shape.familyDiversity +
      0.1 * shape.normalLegShare +
      0.06 * shape.directionBalance -
      0.55 * ultraSafePenalty
    );
  }

  if (objective === "max_ev") {
    return (
      0.5 * hit +
      1.25 * ev +
      0.18 * edgeRatio -
      0.08 * returnDistance -
      1.7 * concentration +
      0.08 * combination.balanceScore +
      0.14 * shape.familyDiversity +
      0.12 * shape.normalLegShare +
      0.05 * shape.directionBalance -
      0.4 * ultraSafePenalty
    );
  }

  return (
    0.82 * hit +
    0.76 * ev +
    0.12 * edgeRatio -
    0.16 * returnDistance -
    2.8 * concentration +
    0.14 * combination.balanceScore +
    0.16 * shape.familyDiversity +
    0.13 * shape.normalLegShare +
    0.07 * shape.directionBalance -
    0.6 * ultraSafePenalty
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
  const shape = combinationShape(state.legs);
  const ultraSafePenalty =
    state.legs.length >= 4 ? Math.max(0, shape.ultraSafeShare - 0.5) : 0;

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
    0.1 * balanceScore +
    0.12 * shape.familyDiversity +
    0.1 * shape.normalLegShare +
    0.05 * shape.directionBalance -
    0.45 * ultraSafePenalty
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
  const beamWidth = resultLimit > 1 ? 3_200 : 4_200;
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
          state.legs.some((leg) =>
            mutuallyExclusiveMoneylines(leg.market, candidate.market),
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
          .slice(0, resultLimit > 1 ? 88 : 112),
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
    Math.max(2, Math.min(limit, 96)),
  );
}

export function buildBestAvailableCombination(
  opportunities: MarketOpportunity[],
  options: BuilderOptions,
): BuiltCombination | null {
  return buildCombination(opportunities, options);
}


function combinationIdentity(market: MarketOpportunity) {
  return market.canonical?.key ?? `${market.platform}:${market.platformMarketId}`;
}

function overlapShare(
  first: BuiltCombination,
  second: BuiltCombination,
  selector: (market: MarketOpportunity) => string,
) {
  const left = new Set(first.legs.map(selector));
  const right = new Set(second.legs.map(selector));
  const denominator = Math.max(1, Math.min(left.size, right.size));
  let shared = 0;
  for (const key of left) if (right.has(key)) shared += 1;
  return shared / denominator;
}

function combinationSimilarity(
  first: BuiltCombination,
  second: BuiltCombination,
) {
  const exact = overlapShare(first, second, combinationIdentity);
  const subjects = overlapShare(
    first,
    second,
    (market) =>
      market.canonical?.subject.toLowerCase() ??
      combinationIdentity(market),
  );
  const games = overlapShare(first, second, gameKey);
  return clamp(exact * 0.68 + subjects * 0.22 + games * 0.10, 0, 1);
}

function maximumSharedExactLegs(first: BuiltCombination, second: BuiltCombination) {
  const left = new Set(first.legs.map(combinationIdentity));
  const right = new Set(second.legs.map(combinationIdentity));
  let shared = 0;
  for (const key of left) if (right.has(key)) shared += 1;
  return shared;
}

function isMeaningfullyDistinct(
  candidate: BuiltCombination,
  selected: BuiltCombination[],
) {
  return selected.every((row) => {
    const smallerLegCount = Math.min(candidate.legs.length, row.legs.length);
    if (smallerLegCount <= 2) return true;
    const sharedExact = maximumSharedExactLegs(candidate, row);

    // One swapped leg is not a new option. A four-leg build may share at most
    // two exact legs with another four-leg build; larger builds stay under
    // roughly half exact overlap as well.
    const maxSharedExact =
      smallerLegCount === 3 ? 1 : Math.floor(smallerLegCount / 2);
    if (sharedExact > maxSharedExact) return false;

    // Also reject a near-identical player thesis even when the exact lines
    // differ. This prevents alternate thresholds from masquerading as variety.
    const subjectOverlap = overlapShare(
      candidate,
      row,
      (market) =>
        market.canonical?.subject.toLowerCase() ??
        combinationIdentity(market),
    );
    return subjectOverlap <= 0.67;
  });
}

function selectDistinctCombinations(
  candidates: BuiltCombination[],
  limit: number,
) {
  const remaining = [...candidates];
  const selected: BuiltCombination[] = [];

  while (remaining.length && selected.length < limit) {
    let bestIndex = 0;
    let bestUtility = -Infinity;

    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index]!;
      if (!isMeaningfullyDistinct(candidate, selected)) continue;
      const maxSimilarity = selected.length
        ? Math.max(
            ...selected.map((row) => combinationSimilarity(candidate, row)),
          )
        : 0;
      const maxExactOverlap = selected.length
        ? Math.max(
            ...selected.map((row) =>
              overlapShare(candidate, row, combinationIdentity),
            ),
          )
        : 0;

      // Prefer a genuinely different thesis whenever one exists. Three of the
      // same four legs with one swap is not a new option.
      const duplicateThesisPenalty =
        maxExactOverlap > 0.5 ? 28 + (maxExactOverlap - 0.5) * 80 : 0;
      const utility =
        candidate.lynervaScore +
        candidate.expectedProfitOn100 * 0.08 -
        maxSimilarity * 24 -
        duplicateThesisPenalty;

      if (utility > bestUtility) {
        bestUtility = utility;
        bestIndex = index;
      }
    }

    if (bestUtility === -Infinity) break;
    selected.push(remaining.splice(bestIndex, 1)[0]!);
  }

  return selected.toSorted(
    (first, second) =>
      second.lynervaScore - first.lynervaScore ||
      second.expectedValueMultiplier - first.expectedValueMultiplier ||
      second.estimatedProbability - first.estimatedProbability,
  );
}

export function buildRankedCombinations(
  opportunities: MarketOpportunity[],
  options: BuilderOptions,
  limit = 6,
): BuiltCombination[] {
  const candidates = buildCombinationCandidates(
    opportunities,
    options,
    Math.max(24, Math.min(limit * 10, 96)),
  ).toSorted(
    (first, second) =>
      second.lynervaScore - first.lynervaScore ||
      second.expectedValueMultiplier - first.expectedValueMultiplier ||
      second.estimatedProbability - first.estimatedProbability,
  );

  return selectDistinctCombinations(
    candidates,
    Math.max(1, limit),
  );
}

export function buildTopScoredCombinations(
  opportunities: MarketOpportunity[],
  limit = 10,
): BuiltCombination[] {
  return buildRankedCombinations(
    opportunities,
    {
      minReturn: 1.3,
      maxReturn: 500,
      maxLegs: 10,
      platform: "kalshi",
      live: "pregame",
      mode: "any",
      objective: "balanced",
    },
    limit,
  );
}
