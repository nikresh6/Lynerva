import type { MarketOpportunity, Platform } from "@/lib/markets/types";
import { clamp } from "@/lib/utils";
import {
  buildCombinationCandidates,
  type BuilderMode,
  type BuilderObjective,
  type BuiltCombination,
} from "./index";

export type PortfolioRisk = "lower" | "balanced" | "higher";

export interface PortfolioPlanOptions {
  amount: number;
  targetPayout: number;
  risk: PortfolioRisk;
  platform: "either" | Platform;
  live: "all" | "pregame" | "live";
  mode: BuilderMode;
  maxLegs: number;
}

export interface PortfolioPosition {
  id: string;
  kind: "straight" | "parlay";
  stake: number;
  grossReturn: number;
  estimatedProbability: number;
  expectedValueMultiplier: number;
  expectedProfit: number;
  payoutIfWin: number;
  legs: MarketOpportunity[];
  parlayMode: "multi_game" | "sgp" | null;
}

export interface PortfolioPlan {
  positions: PortfolioPosition[];
  totalStake: number;
  targetPayout: number;
  targetReturn: number;
  allWinPayout: number;
  expectedPayout: number;
  expectedProfit: number;
  straightStakeShare: number;
  parlayStakeShare: number;
  maxPositionShare: number;
  averagePositionProbability: number;
}

interface Candidate {
  id: string;
  kind: "straight" | "parlay";
  legs: MarketOpportunity[];
  grossReturn: number;
  probability: number;
  expectedValueMultiplier: number;
  score: number;
  parlayMode: "multi_game" | "sgp" | null;
}

function adjustedProbability(market: MarketOpportunity) {
  const price = (market.executablePriceBps ?? 0) / 10_000;
  const model = (market.recommendedProbabilityBps ?? 0) / 10_000;
  const reliability = clamp(market.model.reliabilityBps / 10_000, 0, 1);
  return clamp(price + reliability * (model - price), 0.001, 0.999);
}

function marketKey(market: MarketOpportunity) {
  return (
    market.canonical?.key ??
    `${market.platform}:${market.platformMarketId}:${market.recommendedSide}`
  );
}

function playerStatKey(market: MarketOpportunity) {
  const canonical = market.canonical;
  if (!canonical) return marketKey(market);
  return [
    canonical.matchup ?? market.eventTitle.toLowerCase(),
    canonical.subject.toLowerCase(),
    canonical.family,
  ].join("|");
}

function candidateExposureKeys(candidate: Candidate) {
  const keys = new Set<string>();
  for (const leg of candidate.legs) {
    keys.add(`market:${marketKey(leg)}`);
    keys.add(`player-stat:${playerStatKey(leg)}`);
  }
  return keys;
}

function overlapShare(first: Candidate, second: Candidate) {
  const firstKeys = candidateExposureKeys(first);
  const secondKeys = candidateExposureKeys(second);
  let overlap = 0;

  for (const key of firstKeys) {
    if (secondKeys.has(key)) overlap += 1;
  }

  return overlap / Math.max(1, Math.min(firstKeys.size, secondKeys.size));
}

function straightCandidates(
  opportunities: MarketOpportunity[],
  options: PortfolioPlanOptions,
) {
  const rows: Candidate[] = [];

  for (const market of opportunities) {
    if (
      market.executablePriceBps === null ||
      market.executablePriceBps <= 0 ||
      market.executablePriceBps >= 10_000 ||
      market.recommendedProbabilityBps === null ||
      !market.canonical ||
      market.freshness === "stale"
    ) {
      continue;
    }

    if (
      options.platform !== "either" &&
      market.platform !== options.platform
    ) {
      continue;
    }
    if (options.live === "live" && !market.isLive) continue;
    if (options.live === "pregame" && market.isLive) continue;

    const price = market.executablePriceBps / 10_000;
    const probability = adjustedProbability(market);
    const grossReturn = 1 / price;
    const expectedValueMultiplier = probability * grossReturn;

    if (expectedValueMultiplier <= 1) continue;

    const reliability = clamp(market.model.reliabilityBps / 10_000, 0, 1);
    const score =
      0.9 * Math.log(expectedValueMultiplier) +
      0.75 * Math.log(probability) +
      0.2 * reliability;

    rows.push({
      id: `straight:${marketKey(market)}`,
      kind: "straight",
      legs: [market],
      grossReturn,
      probability,
      expectedValueMultiplier,
      score,
      parlayMode: null,
    });
  }

  const bestByPlayerStat = new Map<string, Candidate>();
  for (const candidate of rows.toSorted(
    (first, second) =>
      second.score - first.score ||
      second.probability - first.probability ||
      second.expectedValueMultiplier - first.expectedValueMultiplier,
  )) {
    const market = candidate.legs[0];
    if (!market) continue;
    const key = playerStatKey(market);
    if (!bestByPlayerStat.has(key)) {
      bestByPlayerStat.set(key, candidate);
    }
  }

  return [...bestByPlayerStat.values()]
    .toSorted(
      (first, second) =>
        second.score - first.score ||
        second.probability - first.probability ||
        second.expectedValueMultiplier - first.expectedValueMultiplier,
    )
    .slice(0, 18);
}

function parlayCandidate(
  combination: BuiltCombination | null,
  mode: "multi_game" | "sgp",
): Candidate | null {
  if (!combination || combination.legs.length < 2) return null;

  const id = combination.legs
    .map(marketKey)
    .toSorted()
    .join("+");

  const score =
    0.85 * Math.log(Math.max(combination.expectedValueMultiplier, 1e-6)) +
    0.55 * Math.log(Math.max(combination.estimatedProbability, 1e-6)) +
    0.1 * combination.balanceScore;

  return {
    id: `parlay:${id}`,
    kind: "parlay",
    legs: combination.legs,
    grossReturn: combination.grossReturn,
    probability: combination.estimatedProbability,
    expectedValueMultiplier: combination.expectedValueMultiplier,
    score,
    parlayMode: mode,
  };
}

function parlayCandidates(
  opportunities: MarketOpportunity[],
  options: PortfolioPlanOptions,
  targetReturn: number,
) {
  const modes: Array<"multi_game" | "sgp"> =
    options.mode === "any"
      ? ["multi_game", "sgp"]
      : [options.mode === "sgp" ? "sgp" : "multi_game"];

  const objective: BuilderObjective =
    options.risk === "lower"
      ? "safer"
      : options.risk === "higher"
        ? "max_ev"
        : "balanced";

  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  const maxReturn = Math.min(40, Math.max(8, targetReturn * 1.9));

  for (const mode of modes) {
    const built = buildCombinationCandidates(
      opportunities,
      {
        minReturn: 1.7,
        maxReturn,
        maxLegs: options.maxLegs,
        platform: options.platform,
        live: options.live,
        mode,
        objective,
      },
      options.mode === "any" ? 6 : 8,
    );

    for (const combination of built) {
      const candidate = parlayCandidate(combination, mode);
      if (!candidate || seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      candidates.push(candidate);
    }
  }

  return candidates.toSorted(
    (first, second) =>
      second.score - first.score ||
      second.expectedValueMultiplier - first.expectedValueMultiplier,
  );
}

function pickDiverse(
  candidates: Candidate[],
  count: number,
  avoid: Candidate[] = [],
) {
  const selected: Candidate[] = [];

  while (selected.length < count) {
    let best: Candidate | null = null;
    let bestScore = -Infinity;

    for (const candidate of candidates) {
      if (selected.some((row) => row.id === candidate.id)) continue;

      const references = [...avoid, ...selected];
      const overlap = references.length
        ? Math.max(...references.map((row) => overlapShare(candidate, row)))
        : 0;
      if (overlap >= 0.5) continue;

      const score = candidate.score - 1.0 * overlap;

      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }

    if (!best) break;
    selected.push(best);
  }

  return selected;
}

function riskConfig(risk: PortfolioRisk, targetReturn: number) {
  if (risk === "lower") {
    return {
      maxParlayShare: clamp(0.18 + (targetReturn - 1) * 0.08, 0.18, 0.42),
      minParlayShare: 0.1,
      maxPositionShare: 0.26,
      maxParlays: 2,
      maxStraights: 5,
    };
  }

  if (risk === "higher") {
    return {
      maxParlayShare: clamp(0.48 + (targetReturn - 1) * 0.08, 0.48, 0.78),
      minParlayShare: 0.3,
      maxPositionShare: 0.4,
      maxParlays: 3,
      maxStraights: 3,
    };
  }

  return {
    maxParlayShare: clamp(0.32 + (targetReturn - 1) * 0.09, 0.32, 0.64),
    minParlayShare: 0.2,
    maxPositionShare: 0.34,
    maxParlays: 3,
    maxStraights: 4,
  };
}

function averageReturn(candidates: Candidate[]) {
  if (!candidates.length) return 1;
  return (
    candidates.reduce((sum, candidate) => sum + candidate.grossReturn, 0) /
    candidates.length
  );
}

function choosePrimaryParlay(
  parlays: Candidate[],
  targetReturn: number,
  straightReturn: number,
  config: ReturnType<typeof riskConfig>,
) {
  if (!parlays.length) return null;

  let best: Candidate | null = null;
  let bestScore = -Infinity;

  for (const parlay of parlays) {
    const denominator = parlay.grossReturn - straightReturn;
    const requiredShare =
      denominator > 0 ? (targetReturn - straightReturn) / denominator : 1;
    const feasibleShare = clamp(
      requiredShare,
      config.minParlayShare,
      config.maxParlayShare,
    );
    const blendedReturn =
      (1 - feasibleShare) * straightReturn +
      feasibleShare * parlay.grossReturn;
    const distance = Math.abs(
      Math.log(Math.max(blendedReturn, 1.001) / targetReturn),
    );
    const score = parlay.score - 1.4 * distance;

    if (score > bestScore) {
      best = parlay;
      bestScore = score;
    }
  }

  return best;
}

function allocateAmounts(
  total: number,
  candidates: Candidate[],
  categoryShare: number,
  maxPositionShare: number,
) {
  if (!candidates.length || categoryShare <= 0) return [] as number[];

  const categoryAmount = total * categoryShare;
  const maxAmount = total * maxPositionShare;
  const weights = candidates.map((candidate) =>
    Math.max(0.15, Math.exp(candidate.score)),
  );
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);

  let amounts = weights.map((weight) =>
    Math.min(maxAmount, categoryAmount * (weight / weightTotal)),
  );

  let remaining = categoryAmount - amounts.reduce((sum, value) => sum + value, 0);
  for (let pass = 0; pass < 4 && remaining > 0.005; pass += 1) {
    const expandable = amounts
      .map((value, index) => ({ value, index }))
      .filter(({ value }) => value < maxAmount - 0.005);
    if (!expandable.length) break;

    const addition = remaining / expandable.length;
    for (const { index } of expandable) {
      const room = maxAmount - (amounts[index] ?? 0);
      const applied = Math.min(room, addition);
      amounts[index] = (amounts[index] ?? 0) + applied;
      remaining -= applied;
    }
  }

  return amounts.map((value) => Math.round(value * 100) / 100);
}

function toPosition(candidate: Candidate, stake: number): PortfolioPosition {
  return {
    id: candidate.id,
    kind: candidate.kind,
    stake,
    grossReturn: candidate.grossReturn,
    estimatedProbability: candidate.probability,
    expectedValueMultiplier: candidate.expectedValueMultiplier,
    expectedProfit: stake * (candidate.expectedValueMultiplier - 1),
    payoutIfWin: stake * candidate.grossReturn,
    legs: candidate.legs,
    parlayMode: candidate.parlayMode,
  };
}

export function buildPortfolioPlan(
  opportunities: MarketOpportunity[],
  options: PortfolioPlanOptions,
): PortfolioPlan | null {
  if (
    !Number.isFinite(options.amount) ||
    options.amount <= 0 ||
    !Number.isFinite(options.targetPayout) ||
    options.targetPayout <= options.amount ||
    options.maxLegs < 2
  ) {
    return null;
  }

  const targetReturn = clamp(options.targetPayout / options.amount, 1.05, 25);
  const straights = straightCandidates(opportunities, options);
  const parlays = parlayCandidates(opportunities, options, targetReturn);

  if (!straights.length || !parlays.length) return null;

  const config = riskConfig(options.risk, targetReturn);
  const preliminaryStraights = pickDiverse(
    straights,
    Math.min(config.maxStraights, straights.length),
  );
  const straightReturn = averageReturn(preliminaryStraights);
  const primaryParlay = choosePrimaryParlay(
    parlays,
    targetReturn,
    straightReturn,
    config,
  );

  if (!primaryParlay) return null;

  const requiredParlayShare =
    primaryParlay.grossReturn > straightReturn
      ? (targetReturn - straightReturn) /
        (primaryParlay.grossReturn - straightReturn)
      : config.maxParlayShare;
  const preliminaryParlayShare = clamp(
    requiredParlayShare,
    config.minParlayShare,
    config.maxParlayShare,
  );
  const preliminaryStraightShare = 1 - preliminaryParlayShare;

  const parlayCount = Math.min(
    config.maxParlays,
    parlays.length,
    Math.max(1, Math.ceil(preliminaryParlayShare / config.maxPositionShare)),
  );
  const straightCount = Math.min(
    config.maxStraights,
    straights.length,
    Math.max(2, Math.ceil(preliminaryStraightShare / config.maxPositionShare)),
  );

  const partnerPool = parlays.filter(
    (row) =>
      row.id !== primaryParlay.id &&
      row.grossReturn >= primaryParlay.grossReturn * 0.6 &&
      row.grossReturn <= primaryParlay.grossReturn * 1.65,
  );
  const selectedParlays = [
    primaryParlay,
    ...pickDiverse(
      partnerPool.length ? partnerPool : parlays.filter((row) => row.id !== primaryParlay.id),
      Math.max(0, parlayCount - 1),
      [primaryParlay],
    ),
  ];
  const selectedStraights = pickDiverse(
    straights,
    straightCount,
    selectedParlays,
  );

  if (!selectedStraights.length || !selectedParlays.length) return null;

  const selectedStraightReturn = averageReturn(selectedStraights);
  const selectedParlayReturn = averageReturn(selectedParlays);
  const finalRequiredParlayShare =
    selectedParlayReturn > selectedStraightReturn
      ? (targetReturn - selectedStraightReturn) /
        (selectedParlayReturn - selectedStraightReturn)
      : config.maxParlayShare;
  const parlayShare = clamp(
    finalRequiredParlayShare,
    config.minParlayShare,
    config.maxParlayShare,
  );
  const straightShare = 1 - parlayShare;

  const straightAmounts = allocateAmounts(
    options.amount,
    selectedStraights,
    straightShare,
    config.maxPositionShare,
  );
  const parlayAmounts = allocateAmounts(
    options.amount,
    selectedParlays,
    parlayShare,
    config.maxPositionShare,
  );

  const positions = [
    ...selectedStraights.map((candidate, index) =>
      toPosition(candidate, straightAmounts[index] ?? 0),
    ),
    ...selectedParlays.map((candidate, index) =>
      toPosition(candidate, parlayAmounts[index] ?? 0),
    ),
  ].filter((position) => position.stake > 0);

  if (!positions.length) return null;

  const allocated = positions.reduce((sum, position) => sum + position.stake, 0);
  const roundingDifference = Math.round((options.amount - allocated) * 100) / 100;
  if (Math.abs(roundingDifference) >= 0.01) {
    const safest = positions
      .map((position, index) => ({ position, index }))
      .toSorted(
        (first, second) =>
          second.position.estimatedProbability -
          first.position.estimatedProbability,
      )[0];

    if (safest) {
      positions[safest.index] = {
        ...safest.position,
        stake: safest.position.stake + roundingDifference,
        expectedProfit:
          (safest.position.stake + roundingDifference) *
          (safest.position.expectedValueMultiplier - 1),
        payoutIfWin:
          (safest.position.stake + roundingDifference) *
          safest.position.grossReturn,
      };
    }
  }

  const totalStake = positions.reduce((sum, position) => sum + position.stake, 0);
  const allWinPayout = positions.reduce(
    (sum, position) => sum + position.payoutIfWin,
    0,
  );
  const targetDistance =
    Math.abs(allWinPayout - options.targetPayout) /
    Math.max(options.targetPayout, 1);
  if (targetDistance > 0.4) return null;
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
  const maxStake = Math.max(...positions.map((position) => position.stake));

  return {
    positions: positions.toSorted(
      (first, second) =>
        first.kind.localeCompare(second.kind) ||
        second.stake - first.stake,
    ),
    totalStake,
    targetPayout: options.targetPayout,
    targetReturn,
    allWinPayout,
    expectedPayout,
    expectedProfit: expectedPayout - totalStake,
    straightStakeShare: 1 - parlayStake / Math.max(totalStake, 0.01),
    parlayStakeShare: parlayStake / Math.max(totalStake, 0.01),
    maxPositionShare: maxStake / Math.max(totalStake, 0.01),
    averagePositionProbability:
      positions.reduce(
        (sum, position) => sum + position.estimatedProbability,
        0,
      ) / positions.length,
  };
}
