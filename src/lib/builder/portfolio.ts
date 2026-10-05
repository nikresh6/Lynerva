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
  | "hedge_straight"
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
  subjectTeams?: Record<string, string | null | undefined>;
  singleGame?: boolean;
  maxPositions?: number;
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
  lineSafety: number;
  parlayMode: "multi_game" | "sgp" | null;
}

interface ShareBounds {
  min: number;
  max: number;
}

function adjustedProbability(market: MarketOpportunity) {
  return clamp(
    (market.recommendedProbabilityBps ?? 0) / 10_000,
    0.001,
    0.999,
  );
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

function pickDirection(market: MarketOpportunity) {
  const canonical = market.canonical;
  if (!canonical) return market.recommendedSide ?? "yes";
  if (market.recommendedSide !== "no") return canonical.direction;
  if (canonical.direction === "over") return "under";
  if (canonical.direction === "under") return "over";
  if (canonical.direction === "yes") return "no";
  return "yes";
}

function marketVariantKey(market: MarketOpportunity) {
  return `${marketKey(market)}:${market.recommendedSide ?? "yes"}`;
}

function lineSafetyScores(opportunities: MarketOpportunity[]) {
  const groups = new Map<string, MarketOpportunity[]>();
  for (const market of opportunities) {
    const threshold = market.canonical?.threshold;
    const direction = pickDirection(market);
    if (
      !market.canonical ||
      threshold === null ||
      threshold === undefined ||
      (direction !== "over" && direction !== "under")
    ) {
      continue;
    }

    const key = `${playerStatKey(market)}|${direction}`;
    const rows = groups.get(key) ?? [];
    rows.push(market);
    groups.set(key, rows);
  }

  const scores = new Map<string, number>();
  for (const rows of groups.values()) {
    const direction = pickDirection(rows[0]!);
    const sorted = rows.toSorted((first, second) => {
      const left = first.canonical?.threshold ?? 0;
      const right = second.canonical?.threshold ?? 0;
      return direction === "over" ? left - right : right - left;
    });
    for (let index = 0; index < sorted.length; index += 1) {
      const market = sorted[index]!;
      const score =
        sorted.length <= 1 ? 0.5 : 1 - index / (sorted.length - 1);
      scores.set(marketVariantKey(market), score);
    }
  }
  return scores;
}

const YARDAGE_FAMILIES = new Set([
  "passing_yards",
  "rushing_yards",
  "receiving_yards",
]);

const TOUCHDOWN_FAMILIES = new Set([
  "passing_touchdowns",
  "rushing_touchdowns",
  "receiving_touchdowns",
  "touchdowns",
]);

function allowedSingleGameSubjectPair(
  first: MarketOpportunity,
  second: MarketOpportunity,
) {
  const firstSubject = first.canonical?.subject?.toLowerCase();
  const secondSubject = second.canonical?.subject?.toLowerCase();
  if (!firstSubject || !secondSubject || firstSubject !== secondSubject) {
    return true;
  }

  const firstFamily = first.canonical?.family ?? "other";
  const secondFamily = second.canonical?.family ?? "other";
  const firstThreshold = first.canonical?.threshold;
  const secondThreshold = second.canonical?.threshold;
  const nestedAlternateLine =
    firstFamily === secondFamily &&
    first.canonical?.statistic === second.canonical?.statistic &&
    firstThreshold !== null &&
    firstThreshold !== undefined &&
    secondThreshold !== null &&
    secondThreshold !== undefined &&
    firstThreshold !== secondThreshold &&
    pickDirection(first) === pickDirection(second);

  return (
    nestedAlternateLine ||
    (YARDAGE_FAMILIES.has(firstFamily) &&
      TOUCHDOWN_FAMILIES.has(secondFamily)) ||
    (TOUCHDOWN_FAMILIES.has(firstFamily) &&
      YARDAGE_FAMILIES.has(secondFamily))
  );
}

function candidateSingleGameCompatible(
  candidate: Candidate,
  selected: Candidate[],
) {
  for (let left = 0; left < candidate.legs.length; left += 1) {
    for (let right = left + 1; right < candidate.legs.length; right += 1) {
      const first = candidate.legs[left];
      const second = candidate.legs[right];
      if (first && second && !allowedSingleGameSubjectPair(first, second)) {
        return false;
      }
    }
  }

  // Separate tickets may deliberately reuse a strong anchor. A good straight
  // can also be one leg of a core or upside parlay. Cap that exposure rather
  // than banning it outright, otherwise one-game portfolios cannot layer risk.
  const exactMarketCounts = new Map<string, number>();
  const playerStatCounts = new Map<string, number>();
  const subjectCounts = new Map<string, number>();
  for (const leg of [
    ...selected.flatMap((row) => row.legs),
    ...candidate.legs,
  ]) {
    const market = marketKey(leg);
    const nextMarket = (exactMarketCounts.get(market) ?? 0) + 1;
    if (nextMarket > 2) return false;
    exactMarketCounts.set(market, nextMarket);

    const statKey = playerStatKey(leg);
    const nextStat = (playerStatCounts.get(statKey) ?? 0) + 1;
    if (nextStat > 3) return false;
    playerStatCounts.set(statKey, nextStat);

    const subject =
      leg.canonical?.subject.toLowerCase() ?? market;
    const nextSubject = (subjectCounts.get(subject) ?? 0) + 1;
    if (nextSubject > 4) return false;
    subjectCounts.set(subject, nextSubject);
  }

  return true;
}

function subjectTeam(
  market: MarketOpportunity,
  subjectTeams?: PortfolioPlanOptions["subjectTeams"],
) {
  const subject = market.canonical?.subject;
  if (!subject) return null;
  if (market.canonical?.family === "moneyline") return subject.toUpperCase();
  return subjectTeams?.[subject] ?? null;
}

function setOverlap(first: Set<string>, second: Set<string>) {
  if (!first.size || !second.size) return 0;
  let overlap = 0;
  for (const key of first) if (second.has(key)) overlap += 1;
  return overlap / Math.max(1, Math.min(first.size, second.size));
}

function exposureSets(
  candidate: Candidate,
  subjectTeams?: PortfolioPlanOptions["subjectTeams"],
) {
  return {
    markets: new Set(candidate.legs.map((leg) => marketKey(leg))),
    playerStats: new Set(candidate.legs.map((leg) => playerStatKey(leg))),
    subjects: new Set(
      candidate.legs.map(
        (leg) => leg.canonical?.subject.toLowerCase() ?? marketKey(leg),
      ),
    ),
    games: new Set(
      candidate.legs.map(
        (leg) => leg.canonical?.matchup ?? leg.eventTitle.toLowerCase(),
      ),
    ),
    teams: new Set(
      candidate.legs
        .map((leg) => subjectTeam(leg, subjectTeams))
        .filter((team): team is string => Boolean(team)),
    ),
  };
}

function sharedExactLegs(first: Candidate, second: Candidate) {
  const left = new Set(first.legs.map((leg) => marketKey(leg)));
  const right = new Set(second.legs.map((leg) => marketKey(leg)));
  let shared = 0;
  for (const key of left) if (right.has(key)) shared += 1;
  return shared;
}

function portfolioCandidateIsDistinct(
  candidate: Candidate,
  selected: Candidate[],
  role: PortfolioRole,
  subjectTeams?: PortfolioPlanOptions["subjectTeams"],
) {
  const candidateSubjects = candidate.legs.map(
    (leg) => leg.canonical?.subject.toLowerCase() ?? marketKey(leg),
  );

  for (const row of selected) {
    const sharedExact = sharedExactLegs(candidate, row);
    const sameRole = row.role === role;

    // Alternatives inside the same sleeve should be genuinely different.
    // Across different sleeves, allow one strong leg to carry through without
    // letting the portfolio become the same two-player thesis repeated.
    if (sameRole && sharedExact > 0) return false;
    if (!sameRole && sharedExact > 1) return false;

    const existingStats = new Set(row.legs.map((leg) => playerStatKey(leg)));
    const sharedPlayerStats = candidate.legs.filter((leg) =>
      existingStats.has(playerStatKey(leg)),
    ).length;
    if (sameRole && sharedPlayerStats > 0) return false;
    if (!sameRole && sharedPlayerStats > 1) return false;
  }

  for (const subject of candidateSubjects) {
    const existingOccurrences = selected.reduce(
      (count, row) =>
        count +
        row.legs.filter(
          (leg) =>
            (leg.canonical?.subject.toLowerCase() ?? marketKey(leg)) === subject,
        ).length,
      0,
    );
    if (existingOccurrences >= 3) return false;
  }

  if (candidate.kind !== "parlay") return true;

  return selected.every((row) => {
    if (row.kind !== "parlay") return true;

    const smallerLegCount = Math.min(candidate.legs.length, row.legs.length);
    const sameRole = row.role === role;
    const maxSharedSubjects = sameRole
      ? smallerLegCount <= 3
        ? 0.5
        : 0.6
      : smallerLegCount <= 2
        ? 0.5
        : 0.75;
    const left = exposureSets(candidate, subjectTeams);
    const right = exposureSets(row, subjectTeams);
    return setOverlap(left.subjects, right.subjects) <= maxSharedSubjects;
  });
}

function overlapShare(
  first: Candidate,
  second: Candidate,
  subjectTeams?: PortfolioPlanOptions["subjectTeams"],
) {
  const left = exposureSets(first, subjectTeams);
  const right = exposureSets(second, subjectTeams);
  return clamp(
    setOverlap(left.markets, right.markets) * 0.42 +
      setOverlap(left.playerStats, right.playerStats) * 0.22 +
      setOverlap(left.subjects, right.subjects) * 0.26 +
      setOverlap(left.teams, right.teams) * 0.07 +
      setOverlap(left.games, right.games) * 0.03,
    0,
    1,
  );
}

function hedgeBonus(
  candidate: Candidate,
  selected: Candidate[],
  subjectTeams?: PortfolioPlanOptions["subjectTeams"],
) {
  let offsets = 0;

  for (const candidateLeg of candidate.legs) {
    const candidateGame = candidateLeg.canonical?.matchup;
    const candidateTeam = subjectTeam(candidateLeg, subjectTeams);
    const candidateDirection = pickDirection(candidateLeg);

    for (const existing of selected) {
      for (const existingLeg of existing.legs) {
        if (marketKey(candidateLeg) === marketKey(existingLeg)) continue;
        const existingGame = existingLeg.canonical?.matchup;
        if (!candidateGame || candidateGame !== existingGame) continue;

        const existingDirection = pickDirection(existingLeg);
        const oppositeDirection =
          (candidateDirection === "over" && existingDirection === "under") ||
          (candidateDirection === "under" && existingDirection === "over") ||
          (candidateDirection === "yes" && existingDirection === "no") ||
          (candidateDirection === "no" && existingDirection === "yes");
        const existingTeam = subjectTeam(existingLeg, subjectTeams);
        const differentTeam =
          Boolean(candidateTeam && existingTeam && candidateTeam !== existingTeam);

        const samePlayerStat =
          playerStatKey(candidateLeg) === playerStatKey(existingLeg);
        const candidateThreshold = candidateLeg.canonical?.threshold;
        const existingThreshold = existingLeg.canonical?.threshold;
        const middleWindow =
          samePlayerStat &&
          oppositeDirection &&
          candidateThreshold !== null &&
          candidateThreshold !== undefined &&
          existingThreshold !== null &&
          existingThreshold !== undefined &&
          ((candidateDirection === "over" &&
            candidateThreshold < existingThreshold) ||
            (candidateDirection === "under" &&
              existingDirection === "over" &&
              existingThreshold < candidateThreshold));

        const moneylineCounterweight =
          differentTeam &&
          (candidateLeg.canonical?.family === "moneyline" ||
            existingLeg.canonical?.family === "moneyline");

        if (middleWindow) offsets += 1.5;
        else if (oppositeDirection) {
          offsets += candidateTeam === existingTeam ? 1 : 0.7;
        } else if (moneylineCounterweight) offsets += 0.8;
        else if (differentTeam) offsets += 0.18;
      }
    }
  }

  return clamp(offsets * 0.045, 0, 0.18);
}

function straightRole(probability: number): PortfolioRole {
  if (probability >= 0.5) return "core_straight";
  if (probability >= 0.2) return "value_straight";
  return "aggressive_straight";
}

function straightCandidates(
  opportunities: MarketOpportunity[],
  options: PortfolioPlanOptions,
) {
  const rows: Candidate[] = [];
  const safetyScores = lineSafetyScores(opportunities);

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

    if (expectedValueMultiplier < 0.72) continue;

    const reliability = clamp(market.model.reliabilityBps / 10_000, 0, 1);
    const score =
      1.05 * Math.log(Math.max(expectedValueMultiplier, 0.5)) +
      0.35 * Math.log(probability) +
      0.15 * reliability +
      (expectedValueMultiplier > 1 ? 0.22 : 0);

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
      lineSafety: safetyScores.get(marketVariantKey(market)) ?? 0.5,
      parlayMode: null,
    });
  }

  const perPlayerStat = new Map<string, number>();
  const selected: Candidate[] = [];
  for (const candidate of rows.toSorted(
    (first, second) =>
      second.score - first.score ||
      second.expectedValueMultiplier - first.expectedValueMultiplier,
  )) {
    const market = candidate.legs[0];
    if (!market) continue;
    const key = playerStatKey(market);
    if ((perPlayerStat.get(key) ?? 0) >= 3) continue;
    perPlayerStat.set(key, (perPlayerStat.get(key) ?? 0) + 1);
    selected.push(candidate);
    if (selected.length >= 180) break;
  }

  return selected;
}

function isSafestAlternateStraight(
  candidate: Candidate,
  straights: Candidate[],
) {
  const market = candidate.legs[0];
  const threshold = market?.canonical?.threshold;
  const direction = market ? pickDirection(market) : null;
  if (
    !market ||
    threshold === null ||
    threshold === undefined ||
    (direction !== "over" && direction !== "under")
  ) {
    return false;
  }

  const peers = straights.filter((row) => {
    const peer = row.legs[0];
    return (
      peer &&
      playerStatKey(peer) === playerStatKey(market) &&
      pickDirection(peer) === direction &&
      peer.canonical?.threshold !== null &&
      peer.canonical?.threshold !== undefined
    );
  });
  if (peers.length < 2) return false;

  const thresholds = peers.map((row) => row.legs[0]!.canonical!.threshold!);
  const safestThreshold =
    direction === "over" ? Math.min(...thresholds) : Math.max(...thresholds);
  return Math.abs(threshold - safestThreshold) < 1e-9;
}

function parlayRole(grossReturn: number): PortfolioRole {
  if (grossReturn < 6) return "core_parlay";
  if (grossReturn < 25) return "upside_parlay";
  return "hail_mary";
}

function parlayCandidate(
  combination: BuiltCombination,
  mode: "multi_game" | "sgp",
  safetyScores: Map<string, number>,
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
    lineSafety:
      combination.legs.reduce(
        (sum, leg) =>
          sum + (safetyScores.get(marketVariantKey(leg)) ?? 0.5),
        0,
      ) / Math.max(combination.legs.length, 1),
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
  const safetyScores = lineSafetyScores(opportunities);
  const longLegFloor = Math.min(options.maxLegs, 5);
  const hailLegFloor = Math.min(options.maxLegs, 6);

  const returnBands = [
    { minReturn: 1.3, maxReturn: 6, minLegs: 2, limit: 52 },
    { minReturn: 4.5, maxReturn: 20, minLegs: Math.min(options.maxLegs, 3), limit: 52 },
    { minReturn: 12, maxReturn: 60, minLegs: longLegFloor, limit: 44 },
    { minReturn: 25, maxReturn: 180, minLegs: hailLegFloor, limit: 44 },
  ] as const;

  for (const mode of modes) {
    for (const band of returnBands) {
      const built = buildCombinationCandidates(
        opportunities,
        {
          minReturn: band.minReturn,
          maxReturn: band.maxReturn,
          maxLegs: options.maxLegs,
          minLegs: band.minLegs,
          platform: options.platform,
          live: options.live,
          mode,
          objective,
        },
        band.limit,
      );

      for (const combination of built) {
        // buildCombinationCandidates can return a best-available fallback
        // outside the requested band. Do not relabel that fallback as a Hail
        // Mary or upside ticket.
        if (
          combination.grossReturn < band.minReturn ||
          combination.grossReturn > band.maxReturn
        ) {
          continue;
        }

        const candidate = parlayCandidate(combination, mode, safetyScores);
        if (seen.has(candidate.id)) continue;
        seen.add(candidate.id);
        candidates.push(candidate);
      }
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
    legCountMin?: number;
    legCountMax?: number;
    legProbabilityMin?: number;
    legProbabilityMax?: number;
    requireHedge?: boolean;
    lineSafetyMin?: number;
    preferSaferLines?: boolean;
    role: PortfolioRole;
    subjectTeams?: PortfolioPlanOptions["subjectTeams"];
  },
) {
  let best: Candidate | null = null;
  let bestScore = -Infinity;

  for (const candidate of candidates) {
    if (!portfolioCandidateIsDistinct(candidate, avoid, options.role, options.subjectTeams)) {
      continue;
    }
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
    if (
      options.legCountMin !== undefined &&
      candidate.legs.length < options.legCountMin
    ) {
      continue;
    }
    if (
      options.legCountMax !== undefined &&
      candidate.legs.length > options.legCountMax
    ) {
      continue;
    }
    if (
      options.legProbabilityMin !== undefined &&
      candidate.legs.some(
        (leg) => adjustedProbability(leg) < options.legProbabilityMin!,
      )
    ) {
      continue;
    }
    if (
      options.legProbabilityMax !== undefined &&
      candidate.legs.some(
        (leg) => adjustedProbability(leg) > options.legProbabilityMax!,
      )
    ) {
      continue;
    }
    if (
      options.lineSafetyMin !== undefined &&
      candidate.lineSafety < options.lineSafetyMin
    ) {
      continue;
    }

    const hedge = hedgeBonus(candidate, avoid, options.subjectTeams);
    if (options.requireHedge && hedge <= 0) continue;

    const overlaps = avoid.map((row) =>
      overlapShare(candidate, row, options.subjectTeams),
    );
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

    const returnPenalty =
      options.returnTarget === undefined
        ? 0
        : options.returnTarget < 4
          ? 1.15
          : 0.55;
    const score =
      candidate.score -
      1.45 * maxOverlap -
      0.8 * probabilityDistance -
      returnPenalty * returnDistance +
      hedge +
      (options.preferSaferLines ? 0.32 * candidate.lineSafety : 0);

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
  maxLegs: number,
  subjectTeams?: PortfolioPlanOptions["subjectTeams"],
) {
  const selected: Candidate[] = [];

  const addBest = (
    pool: Candidate[],
    count: number,
    options: Parameters<typeof bestCandidate>[2],
    allowRelaxedFallback = true,
  ) => {
    for (let index = 0; index < count; index += 1) {
      let candidate = bestCandidate(pool, selected, {
        ...options,
        subjectTeams,
      });

      if (!candidate && allowRelaxedFallback) {
        candidate = bestCandidate(pool, selected, {
          role: options.role,
          subjectTeams,
          returnTarget: options.returnTarget,
          probabilityTarget: options.probabilityTarget,
        });
      }

      addCandidate(selected, candidate);
    }
  };

  // Start with a safer alternate-line anchor when one exists. This is the
  // insurance sleeve: it trades some payout for a line with more room while
  // still requiring a useful modeled probability.
  addBest(straights, 1, {
    probabilityMin: 0.5,
    probabilityMax: 0.82,
    probabilityTarget: risk === "lower" ? 0.68 : 0.62,
    lineSafetyMin: 0.6,
    preferSaferLines: true,
    role: "core_straight",
  });

  if (targetReturn >= 2.5) {
    addBest(straights, 1, {
      probabilityMin: 0.48,
      probabilityMax: 0.74,
      probabilityTarget: risk === "lower" ? 0.62 : 0.57,
      preferSaferLines: true,
      role: "core_straight",
    });
  }

  // Add a true offset when the board contains one. This is not forced if the
  // available markets do not provide a sensible hedge.
  addBest(
    straights,
    1,
    {
      probabilityMin: 0.32,
      probabilityMax: 0.78,
      probabilityTarget: 0.55,
      requireHedge: true,
      role: "hedge_straight",
    },
    false,
  );

  addBest(straights, 2, {
    probabilityMin: 0.12,
    probabilityMax: 0.48,
    probabilityTarget: risk === "higher" ? 0.28 : 0.36,
    role: "value_straight",
  });

  if (risk === "higher" || targetReturn >= 4) {
    addBest(straights, 1, {
      probabilityMin: 0.08,
      probabilityMax: 0.32,
      probabilityTarget: 0.2,
      role: "aggressive_straight",
    });
  }

  // For genuinely high return targets, reserve one real longshot before
  // ordinary parlays consume all of the distinct exposure. It remains a tiny
  // bankroll sleeve, but must actually be 25x+ rather than a relaxed fallback
  // wearing a Hail Mary label.
  if (targetReturn >= 3.5 || risk === "higher") {
    addBest(
      parlays,
      1,
      {
        probabilityMax: 0.12,
        returnMin: 25,
        returnMax: 150,
        returnTarget: clamp(targetReturn * 8, 25, 90),
        legCountMin: Math.min(maxLegs, risk === "higher" ? 5 : 6),
        legCountMax: maxLegs,
        role: "hail_mary",
      },
      false,
    );
  }

  // Core parlays are built from ordinary legs, roughly the 45%-78% range,
  // so payout comes from several plausible outcomes rather than one 8% leg.
  addBest(parlays, 2, {
    probabilityMin: 0.16,
    probabilityMax: 0.62,
    probabilityTarget: risk === "lower" ? 0.42 : 0.32,
    returnMin: 1.8,
    returnMax: 5.5,
    returnTarget: clamp(targetReturn, 2.1, 4),
    legCountMin: 2,
    legCountMax: 4,
    legProbabilityMin: 0.45,
    legProbabilityMax: 0.82,
    preferSaferLines: true,
    role: "core_parlay",
  });

  // Value parlays may be longer, but each leg still needs to carry a
  // meaningful share of the payout. No market-family quotas are imposed.
  if (targetReturn >= 2.5 || risk !== "lower") {
    addBest(
      parlays,
      risk === "higher" ? 3 : targetReturn >= 3.5 ? 2 : 1,
      {
      probabilityMin: 0.035,
      probabilityMax: 0.3,
      probabilityTarget: 0.12,
      returnMin: 4.5,
      returnMax: 18,
      returnTarget: clamp(targetReturn * 2.2, 6, 12),
      legCountMin: 3,
      legCountMax: 6,
      legProbabilityMin: 0.3,
      legProbabilityMax: 0.75,
      role: "upside_parlay",
      },
    );
  }

  return selected;
}

function selectSingleGamePortfolioCandidates(
  straights: Candidate[],
  parlays: Candidate[],
  risk: PortfolioRisk,
  targetReturn: number,
  subjectTeams: PortfolioPlanOptions["subjectTeams"],
  maxPositions: number,
  maxLegs: number,
) {
  const seeded = selectPortfolioCandidates(
    straights,
    parlays,
    risk,
    targetReturn,
    maxLegs,
    subjectTeams,
  );

  const pool = [
    ...seeded,
    ...straights.slice(0, 28),
    ...parlays.slice(0, 36),
  ];
  const unique = new Map<string, Candidate>();
  for (const candidate of pool) {
    if (!unique.has(candidate.id)) unique.set(candidate.id, candidate);
  }

  const ranked = [...unique.values()].toSorted((first, second) => {
    const firstDistance = Math.abs(
      Math.log(Math.max(first.grossReturn, 1.001) / Math.max(targetReturn, 1.001)),
    );
    const secondDistance = Math.abs(
      Math.log(Math.max(second.grossReturn, 1.001) / Math.max(targetReturn, 1.001)),
    );
    const firstUtility =
      first.score +
      (first.displayScore / 100) * 0.28 +
      Math.log(Math.max(first.expectedValueMultiplier, 1e-6)) * 0.35 -
      firstDistance * 0.08;
    const secondUtility =
      second.score +
      (second.displayScore / 100) * 0.28 +
      Math.log(Math.max(second.expectedValueMultiplier, 1e-6)) * 0.35 -
      secondDistance * 0.08;
    return secondUtility - firstUtility;
  });

  const chosen: Candidate[] = [];

  // Reserve the insurance anchor explicitly. Generic utility ranking can
  // prefer the juicier main line, but the bankroll builder should use a safer
  // alternate line when the same player/stat offers one with real model value.
  const safeAnchor = straights
    .filter(
      (row) =>
        row.role === "core_straight" &&
        row.probability >= 0.5 &&
        row.probability <= 0.85 &&
        isSafestAlternateStraight(row, straights),
    )
    .toSorted(
      (first, second) =>
        second.expectedValueMultiplier - first.expectedValueMultiplier ||
        second.score - first.score,
    )[0];
  if (safeAnchor) chosen.push({ ...safeAnchor, role: "core_straight" });

  // For a 3.5x+ target, reserve one genuine long-form upside ticket when the
  // board can support it. This is a small sleeve, not a forced majority bet.
  const shouldReserveLongshot =
    risk === "higher" || (risk !== "lower" && targetReturn >= 3.5);
  if (shouldReserveLongshot && chosen.length < maxPositions) {
    const minimumLongLegs = Math.min(maxLegs, 5);
    const longshot = [...seeded, ...parlays]
      .filter(
        (row) =>
          row.kind === "parlay" &&
          row.legs.length >= minimumLongLegs &&
          row.grossReturn >= Math.max(8, targetReturn * 2) &&
          !chosen.some((selected) => selected.id === row.id),
      )
      .toSorted(
        (first, second) =>
          Number(second.role === "hail_mary") -
            Number(first.role === "hail_mary") ||
          second.grossReturn - first.grossReturn ||
          second.score - first.score,
      )
      .find((row) => candidateSingleGameCompatible(row, chosen));
    if (longshot) chosen.push(longshot);
  }

  const sleeveOrder: PortfolioRole[] =
    risk === "lower"
      ? [
          "core_straight",
          "hedge_straight",
          "value_straight",
          "core_parlay",
          "core_parlay",
          "upside_parlay",
        ]
      : risk === "higher"
        ? [
            "core_straight",
            "value_straight",
            "aggressive_straight",
            "core_parlay",
            "upside_parlay",
            "upside_parlay",
            "hail_mary",
          ]
        : [
            "core_straight",
            "hedge_straight",
            "value_straight",
            "core_parlay",
            "core_parlay",
            "upside_parlay",
            "upside_parlay",
          ];

  for (const role of sleeveOrder) {
    if (chosen.length >= maxPositions) break;

    // Keep the optimizer's purpose-built sleeve choice when it remains
    // compatible. This preserves the safer alternate-line anchor and the
    // reserved longshot before generic ranking fills the remaining slots.
    const eligible = (row: Candidate) =>
      row.role === role &&
      !chosen.some((selected) => selected.id === row.id) &&
      candidateSingleGameCompatible(row, chosen);
    const candidate = seeded.find(eligible) ?? ranked.find(eligible);

    if (candidate) chosen.push(candidate);
  }

  for (const candidate of ranked) {
    if (chosen.length >= maxPositions) break;
    if (chosen.some((row) => row.id === candidate.id)) continue;
    if (!candidateSingleGameCompatible(candidate, chosen)) continue;
    chosen.push(candidate);
  }

  return chosen.slice(0, maxPositions);
}

function shareBounds(
  role: PortfolioRole,
  risk: PortfolioRisk,
  targetReturn: number,
): ShareBounds {
  if (risk === "lower") {
    if (role === "core_straight") return { min: 0.16, max: 0.36 };
    if (role === "hedge_straight") return { min: 0.05, max: 0.16 };
    if (role === "value_straight") return { min: 0.08, max: 0.24 };
    if (role === "aggressive_straight") return { min: 0.02, max: 0.08 };
    if (role === "core_parlay") return { min: 0.05, max: 0.18 };
    if (role === "upside_parlay") return { min: 0.01, max: 0.09 };
    return { min: 0, max: targetReturn >= 5 ? 0.025 : 0.01 };
  }

  if (risk === "higher") {
    if (role === "core_straight") return { min: 0.08, max: 0.24 };
    if (role === "hedge_straight") return { min: 0.03, max: 0.1 };
    if (role === "value_straight") return { min: 0.08, max: 0.2 };
    if (role === "aggressive_straight") return { min: 0.06, max: 0.16 };
    if (role === "core_parlay") return { min: 0.06, max: 0.2 };
    if (role === "upside_parlay") return { min: 0.05, max: 0.18 };
    return { min: 0.01, max: 0.09 };
  }

  if (role === "core_straight") return { min: 0.12, max: 0.3 };
  if (role === "hedge_straight") return { min: 0.04, max: 0.13 };
  if (role === "value_straight") return { min: 0.08, max: 0.22 };
  if (role === "aggressive_straight") return { min: 0.04, max: 0.12 };
  if (role === "core_parlay") return { min: 0.06, max: 0.22 };
  if (role === "upside_parlay") return { min: 0.03, max: 0.14 };
  return { min: targetReturn >= 4 ? 0.005 : 0, max: 0.05 };
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
  amount: number,
) {
  if (!candidates.length) return null;

  const concentrationCap =
    risk === "lower" ? 0.4 : risk === "balanced" ? 0.34 : 0.4;

  let bounds = candidates.map((candidate) => {
    const preferred = shareBounds(candidate.role, risk, targetReturn);
    const highTargetRiskMinimum =
      targetReturn >= 4 &&
      (candidate.role === "value_straight" ||
        candidate.role === "aggressive_straight")
        ? 0.04
        : 0;
    const hailMinimum =
      candidate.role === "hail_mary" && targetReturn >= 5
        ? Math.min(preferred.max, 0.005)
        : 0;

    const practicalDollarFloor =
      amount <= 30 ? 0.5 : amount <= 100 ? 1 : 2;
    const practicalShareFloor = Math.min(
      0.035,
      practicalDollarFloor / Math.max(amount, 0.01),
    );
    const roleMinimum =
      candidate.role === "hail_mary"
        ? targetReturn >= 3.5 && risk !== "lower"
          ? Math.max(hailMinimum, practicalShareFloor)
          : hailMinimum
        : Math.max(
            preferred.min * 0.6,
            practicalShareFloor,
            highTargetRiskMinimum,
          );

    return {
      // Every selected sleeve receives a practical stake. The previous
      // zero-floor allocation could select eight ideas and then fund only two
      // of them, making the Builder behave like a top-picks list.
      min: Math.min(preferred.max, roleMinimum),
      max:
        candidate.role === "hail_mary"
          ? preferred.max
          : Math.min(concentrationCap, Math.max(preferred.max, 0.12)),
    };
  });

  const minimumTotal = bounds.reduce((sum, row) => sum + row.min, 0);
  if (minimumTotal > 0.72) {
    const scale = 0.72 / minimumTotal;
    bounds = bounds.map((row) => ({ ...row, min: row.min * scale }));
  }

  let maxTotal = bounds.reduce((sum, row) => sum + row.max, 0);
  if (maxTotal < 0.9999) {
    // On a narrow board, use the same concentration ceiling across ordinary
    // positions before giving up on a full-bankroll allocation.
    bounds = bounds.map((row, index) =>
      candidates[index]?.role === "hail_mary"
        ? row
        : { ...row, max: concentrationCap },
    );
    maxTotal = bounds.reduce((sum, row) => sum + row.max, 0);
  }

  if (maxTotal < 0.9999) {
    // If there are only one or two usable positions, concentration is
    // mathematically unavoidable. Keep Hail Mary capped, and widen the
    // lowest-risk ordinary positions only as much as necessary.
    const ordinary = candidates
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => candidate.role !== "hail_mary")
      .toSorted(
        (first, second) =>
          second.candidate.probability - first.candidate.probability,
      );
    let missing = 1 - maxTotal;
    for (const row of ordinary) {
      if (missing <= 1e-9) break;
      const current = bounds[row.index]!;
      const room = 1 - current.max;
      const addition = Math.min(room, missing);
      bounds[row.index] = { ...current, max: current.max + addition };
      missing -= addition;
    }
  }

  const lowShares = fillExtreme(candidates, bounds, false);
  const highShares = fillExtreme(candidates, bounds, true);
  const lowReturn = weightedReturn(candidates, lowShares);
  const highReturn = weightedReturn(candidates, highShares);

  if (highReturn <= lowReturn + 1e-9) return lowShares;

  // Weighted all-win payout is linear in stake shares. Interpolating between
  // the lowest-return and highest-return feasible allocations therefore lands
  // exactly on the requested return whenever the selected board can span it.
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

  const targetReturn = clamp(options.targetPayout / options.amount, 1.05, 250);
  const straights = straightCandidates(opportunities, options);
  const parlays = parlayCandidates(opportunities, options);

  if (!straights.length && !parlays.length) return null;

  const maxPositions = Math.max(
    1,
    Math.min(options.maxPositions ?? (options.singleGame ? 8 : 12), 12),
  );
  const selected = options.singleGame
    ? selectSingleGamePortfolioCandidates(
        straights,
        parlays,
        options.risk,
        targetReturn,
        options.subjectTeams,
        maxPositions,
        options.maxLegs,
      )
    : selectPortfolioCandidates(
        straights,
        parlays,
        options.risk,
        targetReturn,
        options.maxLegs,
        options.subjectTeams,
      ).slice(0, maxPositions);

  if (!selected.length) return null;

  const shares = targetShares(
    selected,
    options.risk,
    targetReturn,
    options.amount,
  );
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
  // targetShares already selects the closest feasible mix. Do not throw away a
  // useful plan merely because the available positive-EV contracts cannot hit
  // an arbitrary payout target to within a hard 15% window.

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
    hedge_straight: 1,
    value_straight: 2,
    aggressive_straight: 3,
    core_parlay: 4,
    upside_parlay: 5,
    hail_mary: 6,
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
