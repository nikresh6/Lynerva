import type { MarketOpportunity, Platform } from "@/lib/markets/types";
import { clamp } from "@/lib/utils";
import {
  buildCombinationCandidates,
  type BuilderMode,
  type BuilderObjective,
  type BuiltCombination,
} from "./index";

export type PortfolioRisk = "lower" | "balanced" | "higher";

export type PortfolioRole =
  | "core_straight"
  | "value_straight"
  | "aggressive_straight"
  | "core_parlay"
  | "upside_parlay"
  | "hail_mary";

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
  role: PortfolioRole;
  stake: number;
  grossReturn: number;
  estimatedProbability: number;
  expectedValueMultiplier: number;
  expectedProfit: number;
  payoutIfWin: number;
  lynervaScore: number;
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
  hailMaryStakeShare: number;
  riskyStraightStakeShare: number;
  maxPositionShare: number;
  averagePositionProbability: number;
}

interface Candidate {
  id: string;
  kind: "straight" | "parlay";
  role: PortfolioRole;
  legs: MarketOpportunity[];
  grossReturn: number;
  probability: number;
  expectedValueMultiplier: number;
  score: number;
  displayScore: number;
  parlayMode: "multi_game" | "sgp" | null;
}

interface ShareBounds {
  min: number;
  max: number;
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

function straightRole(probability: number): PortfolioRole {
  if (probability >= 0.75) return "core_straight";
  if (probability >= 0.52) return "value_straight";
  return "aggressive_straight";
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
      1.0 * Math.log(expectedValueMultiplier) +
      0.35 * Math.log(probability) +
      0.15 * reliability;

    rows.push({
      id: `straight:${marketKey(market)}`,
      kind: "straight",
      role: straightRole(probability),
      legs: [market],
      grossReturn,
      probability,
      expectedValueMultiplier,
      score,
      displayScore: market.lynervaScore ?? 50,
      parlayMode: null,
    });
  }

  const bestByPlayerStat = new Map<string, Candidate>();
  for (const candidate of rows.toSorted(
    (first, second) =>
      second.score - first.score ||
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
        second.expectedValueMultiplier - first.expectedValueMultiplier,
    )
    .slice(0, 36);
}

function parlayRole(grossReturn: number): PortfolioRole {
  if (grossReturn < 6) return "core_parlay";
  if (grossReturn < 25) return "upside_parlay";
  return "hail_mary";
}

function parlayCandidate(
  combination: BuiltCombination,
  mode: "multi_game" | "sgp",
): Candidate {
  const id = combination.legs
    .map(marketKey)
    .toSorted()
    .join("+");

  const score =
    0.9 * Math.log(Math.max(combination.expectedValueMultiplier, 1e-6)) +
    0.25 * Math.log(Math.max(combination.estimatedProbability, 1e-6)) +
    0.1 * combination.balanceScore;

  return {
    id: `parlay:${id}`,
    kind: "parlay",
    role: parlayRole(combination.grossReturn),
    legs: combination.legs,
    grossReturn: combination.grossReturn,
    probability: combination.estimatedProbability,
    expectedValueMultiplier: combination.expectedValueMultiplier,
    score,
    displayScore: combination.lynervaScore,
    parlayMode: mode,
  };
}

function parlayCandidates(
  opportunities: MarketOpportunity[],
  options: PortfolioPlanOptions,
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
    const built = buildCombinationCandidates(
      opportunities,
      {
        minReturn: 1.3,
        maxReturn: 150,
        maxLegs: options.maxLegs,
        platform: options.platform,
        live: options.live,
        mode,
        objective,
      },
      30,
    );

    for (const combination of built) {
      const candidate = parlayCandidate(combination, mode);
      if (seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      candidates.push(candidate);
    }
  }

  return candidates;
}

function bestCandidate(
  candidates: Candidate[],
  avoid: Candidate[],
  options: {
    probabilityMin?: number;
    probabilityMax?: number;
    probabilityTarget?: number;
    returnMin?: number;
    returnMax?: number;
    returnTarget?: number;
    role: PortfolioRole;
  },
) {
  let best: Candidate | null = null;
  let bestScore = -Infinity;

  for (const candidate of candidates) {
    if (
      options.probabilityMin !== undefined &&
      candidate.probability < options.probabilityMin
    ) {
      continue;
    }
    if (
      options.probabilityMax !== undefined &&
      candidate.probability > options.probabilityMax
    ) {
      continue;
    }
    if (
      options.returnMin !== undefined &&
      candidate.grossReturn < options.returnMin
    ) {
      continue;
    }
    if (
      options.returnMax !== undefined &&
      candidate.grossReturn > options.returnMax
    ) {
      continue;
    }

    const overlaps = avoid.map((row) => overlapShare(candidate, row));
    const maxOverlap = overlaps.length ? Math.max(...overlaps) : 0;
    const onlyParlays =
      candidate.kind === "parlay" &&
      avoid.every((row) => row.kind === "parlay");
    if (onlyParlays && maxOverlap >= 0.95) continue;

    const probabilityDistance =
      options.probabilityTarget === undefined
        ? 0
        : Math.abs(candidate.probability - options.probabilityTarget);
    const returnDistance =
      options.returnTarget === undefined
        ? 0
        : Math.abs(
            Math.log(
              Math.max(candidate.grossReturn, 1.001) /
                Math.max(options.returnTarget, 1.001),
            ),
          );

    const score =
      candidate.score -
      1.2 * maxOverlap -
      0.8 * probabilityDistance -
      0.4 * returnDistance;

    if (score > bestScore) {
      best = { ...candidate, role: options.role };
      bestScore = score;
    }
  }

  return best;
}

function addCandidate(selected: Candidate[], candidate: Candidate | null) {
  if (!candidate) return;
  if (selected.some((row) => row.id === candidate.id)) return;
  selected.push(candidate);
}

function selectPortfolioCandidates(
  straights: Candidate[],
  parlays: Candidate[],
  risk: PortfolioRisk,
  targetReturn: number,
) {
  const selected: Candidate[] = [];

  addCandidate(
    selected,
    bestCandidate(straights, selected, {
      probabilityMin: 0.72,
      probabilityMax: 0.98,
      probabilityTarget: risk === "lower" ? 0.86 : 0.82,
      role: "core_straight",
    }),
  );

  addCandidate(
    selected,
    bestCandidate(straights, selected, {
      probabilityMin: risk === "lower" ? 0.56 : 0.5,
      probabilityMax: 0.76,
      probabilityTarget: risk === "lower" ? 0.66 : 0.63,
      role: "value_straight",
    }),
  );

  if (
    risk === "higher" ||
    targetReturn >= (risk === "lower" ? 3.5 : 2.5)
  ) {
    addCandidate(
      selected,
      bestCandidate(straights, selected, {
        probabilityMin: risk === "lower" ? 0.44 : 0.28,
        probabilityMax: risk === "higher" ? 0.58 : 0.62,
        probabilityTarget:
          risk === "higher" ? 0.4 : risk === "lower" ? 0.54 : 0.47,
        role: "aggressive_straight",
      }),
    );
  }

  const preferredCoreParlay =
    bestCandidate(parlays, selected, {
      probabilityMin: 0.55,
      probabilityMax: 0.74,
      probabilityTarget: 0.64,
      returnMin: 1.3,
      returnMax: 3.5,
      returnTarget: 1.8,
      role: "core_parlay",
    }) ??
    bestCandidate(parlays, selected, {
      probabilityMin: 0.45,
      returnMin: 1.3,
      returnMax: 4,
      returnTarget: 2.1,
      role: "core_parlay",
    });

  addCandidate(selected, preferredCoreParlay);

  if (targetReturn >= 2.2 || risk === "higher") {
    const upsideTarget = clamp(targetReturn * 2.2, 7, 22);
    addCandidate(
      selected,
      bestCandidate(parlays, selected, {
        returnMin: 6,
        returnMax: 25,
        returnTarget: upsideTarget,
        role: "upside_parlay",
      }),
    );
  }

  if (
    targetReturn >= (risk === "lower" ? 4.5 : 2.8) ||
    risk === "higher"
  ) {
    const hailTarget = clamp(targetReturn * 20, 35, 150);
    addCandidate(
      selected,
      bestCandidate(parlays, selected, {
        returnMin: 25,
        returnMax: 150,
        returnTarget: hailTarget,
        role: "hail_mary",
      }),
    );
  }

  return selected;
}

function shareBounds(
  role: PortfolioRole,
  risk: PortfolioRisk,
  targetReturn: number,
): ShareBounds {
  if (risk === "lower") {
    if (role === "core_straight") return { min: 0.2, max: 0.4 };
    if (role === "value_straight") return { min: 0.15, max: 0.3 };
    if (role === "aggressive_straight") return { min: 0.03, max: 0.1 };
    if (role === "core_parlay") return { min: 0.08, max: 0.22 };
    if (role === "upside_parlay") return { min: 0.02, max: 0.18 };
    return {
      min: 0,
      max: targetReturn >= 4.5 ? 0.025 : 0,
    };
  }

  if (risk === "higher") {
    if (role === "core_straight") return { min: 0.05, max: 0.18 };
    if (role === "value_straight") return { min: 0.08, max: 0.22 };
    if (role === "aggressive_straight") return { min: 0.1, max: 0.25 };
    if (role === "core_parlay") return { min: 0.08, max: 0.24 };
    if (role === "upside_parlay") return { min: 0.06, max: 0.22 };
    return { min: 0.01, max: 0.16 };
  }

  if (role === "core_straight") return { min: 0.12, max: 0.3 };
  if (role === "value_straight") return { min: 0.12, max: 0.26 };
  if (role === "aggressive_straight") return { min: 0.06, max: 0.18 };
  if (role === "core_parlay") return { min: 0.08, max: 0.24 };
  if (role === "upside_parlay") return { min: 0.04, max: 0.18 };
  return {
    min: targetReturn >= 4 ? 0.005 : 0,
    max: targetReturn >= 2.8 ? 0.08 : 0,
  };
}

function fillExtreme(
  candidates: Candidate[],
  bounds: ShareBounds[],
  highestFirst: boolean,
) {
  const shares = bounds.map((row) => row.min);
  let remaining = 1 - shares.reduce((sum, value) => sum + value, 0);

  const order = candidates
    .map((candidate, index) => ({
      index,
      grossReturn: candidate.grossReturn,
    }))
    .toSorted((first, second) =>
      highestFirst
        ? second.grossReturn - first.grossReturn
        : first.grossReturn - second.grossReturn,
    );

  for (const row of order) {
    if (remaining <= 1e-9) break;
    const room = Math.max(0, bounds[row.index]!.max - shares[row.index]!);
    const addition = Math.min(room, remaining);
    shares[row.index] = shares[row.index]! + addition;
    remaining -= addition;
  }

  if (remaining > 1e-6 && order.length) {
    const fallbackIndex = order[0]!.index;
    shares[fallbackIndex] = shares[fallbackIndex]! + remaining;
  }

  return shares;
}

function weightedReturn(candidates: Candidate[], shares: number[]) {
  return candidates.reduce(
    (sum, candidate, index) =>
      sum + candidate.grossReturn * (shares[index] ?? 0),
    0,
  );
}

function targetShares(
  candidates: Candidate[],
  risk: PortfolioRisk,
  targetReturn: number,
) {
  if (!candidates.length) return null;

  let bounds = candidates.map((candidate) =>
    shareBounds(candidate.role, risk, targetReturn),
  );
  const minTotal = bounds.reduce((sum, row) => sum + row.min, 0);
  let maxTotal = bounds.reduce((sum, row) => sum + row.max, 0);

  if (minTotal > 1.0001) return null;

  if (maxTotal < 0.9999) {
    const fallbackCap =
      risk === "lower" ? 0.4 : risk === "balanced" ? 0.34 : 0.4;
    bounds = bounds.map((row) => ({
      ...row,
      max: Math.max(row.max, fallbackCap),
    }));
    maxTotal = bounds.reduce((sum, row) => sum + row.max, 0);
  }

  if (maxTotal < 0.9999) return null;

  const lowShares = fillExtreme(candidates, bounds, false);
  const highShares = fillExtreme(candidates, bounds, true);
  const lowReturn = weightedReturn(candidates, lowShares);
  const highReturn = weightedReturn(candidates, highShares);

  if (highReturn <= lowReturn + 1e-9) return lowShares;

  const alpha = clamp(
    (targetReturn - lowReturn) / (highReturn - lowReturn),
    0,
    1,
  );

  return lowShares.map(
    (share, index) =>
      share + alpha * ((highShares[index] ?? share) - share),
  );
}

function toPosition(
  candidate: Candidate,
  stake: number,
): PortfolioPosition {
  return {
    id: candidate.id,
    kind: candidate.kind,
    role: candidate.role,
    stake,
    grossReturn: candidate.grossReturn,
    estimatedProbability: candidate.probability,
    expectedValueMultiplier: candidate.expectedValueMultiplier,
    expectedProfit: stake * (candidate.expectedValueMultiplier - 1),
    payoutIfWin: stake * candidate.grossReturn,
    lynervaScore: candidate.displayScore,
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

  const targetReturn = clamp(options.targetPayout / options.amount, 1.05, 100);
  const straights = straightCandidates(opportunities, options);
  const parlays = parlayCandidates(opportunities, options);

  if (!straights.length || !parlays.length) return null;

  const selected = selectPortfolioCandidates(
    straights,
    parlays,
    options.risk,
    targetReturn,
  );

  const selectedStraights = selected.filter(
    (candidate) => candidate.kind === "straight",
  );
  const selectedParlays = selected.filter(
    (candidate) => candidate.kind === "parlay",
  );

  if (selectedStraights.length < 2 || selectedParlays.length < 1) return null;

  const shares = targetShares(selected, options.risk, targetReturn);
  if (!shares) return null;

  const positions = selected.map((candidate, index) =>
    toPosition(
      candidate,
      Math.round(options.amount * (shares[index] ?? 0) * 100) / 100,
    ),
  );

  const allocated = positions.reduce((sum, position) => sum + position.stake, 0);
  const roundingDifference =
    Math.round((options.amount - allocated) * 100) / 100;

  if (Math.abs(roundingDifference) >= 0.01) {
    const safest = positions
      .map((position, index) => ({ position, index }))
      .toSorted(
        (first, second) =>
          second.position.estimatedProbability -
          first.position.estimatedProbability,
      )[0];

    if (safest) {
      const stake = safest.position.stake + roundingDifference;
      positions[safest.index] = {
        ...safest.position,
        stake,
        expectedProfit:
          stake * (safest.position.expectedValueMultiplier - 1),
        payoutIfWin: stake * safest.position.grossReturn,
      };
    }
  }

  const nonZeroPositions = positions.filter((position) => position.stake > 0);
  if (!nonZeroPositions.length) return null;

  const totalStake = nonZeroPositions.reduce(
    (sum, position) => sum + position.stake,
    0,
  );
  const allWinPayout = nonZeroPositions.reduce(
    (sum, position) => sum + position.payoutIfWin,
    0,
  );
  const targetDistance =
    Math.abs(allWinPayout - options.targetPayout) /
    Math.max(options.targetPayout, 1);

  if (targetDistance > 0.15) return null;

  const expectedPayout = nonZeroPositions.reduce(
    (sum, position) =>
      sum +
      position.stake *
        position.estimatedProbability *
        position.grossReturn,
    0,
  );
  const parlayStake = nonZeroPositions
    .filter((position) => position.kind === "parlay")
    .reduce((sum, position) => sum + position.stake, 0);
  const hailMaryStake = nonZeroPositions
    .filter((position) => position.role === "hail_mary")
    .reduce((sum, position) => sum + position.stake, 0);
  const riskyStraightStake = nonZeroPositions
    .filter(
      (position) =>
        position.role === "value_straight" ||
        position.role === "aggressive_straight",
    )
    .reduce((sum, position) => sum + position.stake, 0);
  const maxStake = Math.max(
    ...nonZeroPositions.map((position) => position.stake),
  );

  const roleOrder: Record<PortfolioRole, number> = {
    core_straight: 0,
    value_straight: 1,
    aggressive_straight: 2,
    core_parlay: 3,
    upside_parlay: 4,
    hail_mary: 5,
  };

  return {
    positions: nonZeroPositions.toSorted(
      (first, second) =>
        roleOrder[first.role] - roleOrder[second.role] ||
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
    hailMaryStakeShare: hailMaryStake / Math.max(totalStake, 0.01),
    riskyStraightStakeShare:
      riskyStraightStake / Math.max(totalStake, 0.01),
    maxPositionShare: maxStake / Math.max(totalStake, 0.01),
    averagePositionProbability:
      nonZeroPositions.reduce(
        (sum, position) => sum + position.estimatedProbability,
        0,
      ) / nonZeroPositions.length,
  };
}
