import type { MarketOpportunity, Platform } from "@/lib/markets/types";
import { clamp } from "@/lib/utils";
import {
  buildCombination,
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

function candidateLegKeys(candidate: Candidate) {
  return new Set(candidate.legs.map(marketKey));
}

function overlapShare(first: Candidate, second: Candidate) {
  const firstKeys = candidateLegKeys(first);
  const secondKeys = candidateLegKeys(second);
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
  const seenPlayerStats = new Set<string>();
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

    const key = playerStatKey(market);
    if (seenPlayerStats.has(key)) continue;

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
    seenPlayerStats.add(key);
  }

  return rows
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

function parlayBands(targetReturn: number) {
  const target = clamp(targetReturn, 1.25, 25);
  const raw = [
    [1.7, 2.7],
    [2.5, 4.5],
    [Math.max(3.5, target * 0.7), Math.max(5, target * 1.15)],
    [Math.max(5, target * 1.05), Math.min(40, Math.max(8, target * 1.9))],
  ] as const;

  const seen = new Set<string>();
  return raw.flatMap(([min, max]) => {
    const safeMin = Math.max(1.2, Math.min(min, 39));
    const safeMax = Math.max(safeMin + 0.3, Math.min(max, 40));
    const key = `${safeMin.toFixed(2)}:${safeMax.toFixed(2)}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ min: safeMin, max: safeMax }];
  });
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

  for (const mode of modes) {
    for (const band of parlayBands(targetReturn)) {
      const built = buildCombination(opportunities, {
        minReturn: band.min,
        maxReturn: band.max,
        maxLegs: options.maxLegs,
        platform: options.platform,
        live: options.live,
        mode,
        objective,
      });
      const candidate = parlayCandidate(built, mode);
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
      const score = candidate.score - 0.8 * overlap;

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
  const parlayShare = clamp(
    requiredParlayShare,
    config.minParlayShare,
    config.maxParlayShare,
  );
  const straightShare = 1 - parlayShare;

  const parlayCount = Math.min(
    config.maxParlays,
    parlays.length,
    Math.max(1, Math.ceil(parlayShare / config.maxPositionShare)),
  );
  const straightCount = Math.min(
    config.maxStraights,
    straights.length,
    Math.max(2, Math.ceil(straightShare / config.maxPositionShare)),
  );

  const selectedParlays = [
    primaryParlay,
    ...pickDiverse(
      parlays.filter((row) => row.id !== primaryParlay.id),
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
