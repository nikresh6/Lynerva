import type { Direction, MarketFamily } from "@/lib/markets/types";
import { poissonAtLeastProbability } from "./player-probability";

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function erf(value: number) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y =
    1 -
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) *
      Math.exp(-x * x);
  return sign * y;
}

function normalCdf(value: number, mean: number, stdDev: number) {
  return 0.5 * (1 + erf((value - mean) / (stdDev * Math.sqrt(2))));
}

const poissonFamilies = new Set<MarketFamily>([
  "passing_touchdowns",
  "passing_interceptions",
  "rushing_touchdowns",
  "receiving_touchdowns",
  "touchdowns",
]);

const passingScriptFamilies = new Set<MarketFamily>([
  "passing_yards",
  "passing_touchdowns",
  "passing_interceptions",
  "receiving_yards",
  "receptions",
  "longest_reception",
]);

const rushingScriptFamilies = new Set<MarketFamily>([
  "rushing_yards",
  "rushing_touchdowns",
]);

export interface LivePlayerConditionalEstimate {
  probability: number;
  projectedFinal: number;
  expectedRemaining: number;
  remainingStdDev: number | null;
  paceAdjustedFullGameProjection: number;
  paceWeight: number;
}

export function liveInjuryAvailabilityMultiplier(
  status: string | null | undefined,
  detail: string | null | undefined,
) {
  const text = ((status ?? "") + " " + (detail ?? "")).toLowerCase();
  if (!text.trim()) return 1;

  if (
    /ruled out|will not return|won't return|out for the game|inactive|injured reserve|\bout\b/.test(
      text,
    )
  ) {
    return 0;
  }
  if (/doubtful(?: to return)?/.test(text)) return 0.15;
  if (/questionable to return|uncertain to return|return is questionable/.test(text)) {
    return 0.45;
  }

  // A generic pregame "Questionable" tag should not cut a live projection
  // after the player has already taken the field.
  return 1;
}

export function liveGameScriptMultiplier(
  family: MarketFamily,
  playerScoreMargin: number | null,
) {
  if (playerScoreMargin === null || Math.abs(playerScoreMargin) < 7) return 1;

  if (passingScriptFamilies.has(family)) {
    if (playerScoreMargin <= -14) return 1.12;
    if (playerScoreMargin <= -7) return 1.06;
    if (playerScoreMargin >= 14) return 0.84;
    if (playerScoreMargin >= 7) return 0.93;
  }

  if (rushingScriptFamilies.has(family)) {
    if (playerScoreMargin >= 14) return 1.12;
    if (playerScoreMargin >= 7) return 1.06;
    if (playerScoreMargin <= -14) return 0.82;
    if (playerScoreMargin <= -7) return 0.92;
  }

  return 1;
}

export function livePossessionOpportunityMultiplier(
  remainingFraction: number,
  playerTeam: string | null | undefined,
  possessionTeam: string | null | undefined,
) {
  if (!playerTeam || !possessionTeam) return 1;

  const remaining = clamp(remainingFraction, 0, 1);
  if (remaining >= 0.2) return 1;

  // Possession becomes increasingly important late. A player whose offense has
  // the ball can immediately add production, while a player on the sideline
  // first needs a change of possession.
  const lateGameStrength = clamp((0.2 - remaining) / 0.18, 0, 1);
  return playerTeam === possessionTeam
    ? 1 + 0.35 * lateGameStrength
    : 1 - 0.3 * lateGameStrength;
}

export function liveClockManagementMultiplier(
  family: MarketFamily,
  playerScoreMargin: number | null,
  remainingFraction: number,
  playerHasPossession: boolean | null,
  opponentTimeouts: number | null | undefined,
) {
  if (playerScoreMargin === null || remainingFraction >= 0.35) return 1;

  const remaining = clamp(remainingFraction, 0, 1);
  const late = clamp((0.35 - remaining) / 0.32, 0, 1);
  const possessionStrength =
    playerHasPossession === true ? 1 : playerHasPossession === false ? 0.7 : 0.82;
  const timeoutStrength =
    opponentTimeouts === 0
      ? 1.25
      : opponentTimeouts === 1
        ? 1.12
        : opponentTimeouts === 2
          ? 1
          : 0.9;

  if (playerScoreMargin >= 3) {
    if (passingScriptFamilies.has(family)) {
      const leadStrength = clamp(playerScoreMargin / 17, 0.35, 1);
      return clamp(
        1 - 0.48 * late * possessionStrength * timeoutStrength * leadStrength,
        0.46,
        1,
      );
    }

    if (rushingScriptFamilies.has(family)) {
      // A close lead creates clock-killing carries. Very large leads are
      // handled separately by the substitution-risk layer.
      const closeLead = 1 - clamp((playerScoreMargin - 10) / 14, 0, 1);
      return clamp(
        1 + 0.2 * late * possessionStrength * timeoutStrength * closeLead,
        1,
        1.22,
      );
    }
  }

  if (playerScoreMargin <= -3) {
    if (passingScriptFamilies.has(family)) {
      const deficitStrength = clamp(Math.abs(playerScoreMargin) / 17, 0.35, 1);
      return clamp(
        1 + 0.34 * late * possessionStrength * deficitStrength,
        1,
        1.34,
      );
    }

    if (rushingScriptFamilies.has(family)) {
      const deficitStrength = clamp(Math.abs(playerScoreMargin) / 17, 0.35, 1);
      return clamp(1 - 0.3 * late * deficitStrength, 0.7, 1);
    }
  }

  return 1;
}

function starterUsageReference(family: MarketFamily) {
  if (family === "passing_yards") return 180;
  if (family === "passing_touchdowns" || family === "passing_interceptions") {
    return 1.2;
  }
  if (family === "rushing_yards") return 45;
  if (family === "receiving_yards") return 45;
  if (family === "receptions") return 3.5;
  if (family === "longest_reception") return 18;
  return 0.35;
}

export function liveBlowoutSubstitutionMultiplier(
  family: MarketFamily,
  playerScoreMargin: number | null,
  remainingFraction: number,
  baselineFullGameProjection: number,
) {
  if (
    playerScoreMargin === null ||
    Math.abs(playerScoreMargin) < 17 ||
    remainingFraction >= 0.32
  ) {
    return 1;
  }

  const scoreSeverity = clamp((Math.abs(playerScoreMargin) - 14) / 21, 0, 1);
  const timeSeverity = clamp((0.32 - remainingFraction) / 0.28, 0, 1);
  const roleLikelihood = clamp(
    baselineFullGameProjection / starterUsageReference(family),
    0.2,
    1,
  );
  const risk = scoreSeverity * timeSeverity * roleLikelihood;

  // Teams with a secure lead are more likely to protect established starters.
  // Trailing teams can keep starters in for hurry-up or garbage-time production,
  // so their benching penalty is deliberately smaller until the game is extreme.
  const maxPenalty = playerScoreMargin > 0 ? 0.78 : 0.5;
  return clamp(
    1 - maxPenalty * risk,
    playerScoreMargin > 0 ? 0.22 : 0.5,
    1,
  );
}

export function liveExpectedOvertimeFraction(
  playerScoreMargin: number | null,
  remainingFraction: number,
) {
  if (
    playerScoreMargin === null ||
    remainingFraction > 0.14 ||
    Math.abs(playerScoreMargin) > 7
  ) {
    return 0;
  }

  const margin = Math.abs(playerScoreMargin);
  const closeness =
    margin === 0 ? 1 : margin <= 3 ? 0.48 : margin <= 6 ? 0.18 : 0.08;
  const late = clamp((0.14 - remainingFraction) / 0.12, 0, 1);

  // This is expected extra opportunity, not an overtime probability. It adds a
  // modest fraction of a game when the score is close enough that regulation
  // may not be the true end of the player's opportunity.
  return 0.058 * closeness * (0.55 + 0.45 * late);
}

function remainingVolatilityExponent(family: MarketFamily) {
  // Football production arrives in drives and chunk plays, not as a smooth
  // clock-rate process. Using sqrt(time) made late-game yardage distributions
  // collapse too quickly and produced false 95%+ certainty with real drives
  // still possible.
  if (family === "passing_yards") return 0.34;
  if (family === "receiving_yards") return 0.37;
  if (family === "rushing_yards") return 0.4;
  if (family === "receptions") return 0.4;
  return 0.5;
}

function paceWeightFor(family: MarketFamily, elapsedFraction: number) {
  if (poissonFamilies.has(family)) {
    return clamp((elapsedFraction - 0.2) * 0.4, 0, 0.26);
  }
  if (family === "longest_reception") {
    return clamp((elapsedFraction - 0.2) * 0.35, 0, 0.22);
  }
  return clamp((elapsedFraction - 0.1) * 0.8, 0, 0.62);
}

function paceAdjustedProjection(input: {
  family: MarketFamily;
  currentValue: number;
  baselineFullGameProjection: number;
  remainingFraction: number;
}) {
  const remaining = clamp(input.remainingFraction, 0.001, 1);
  const elapsed = clamp(1 - remaining, 0.03, 0.999);
  const baseline = Math.max(0, input.baselineFullGameProjection);
  const observedFullGamePace = Math.max(0, input.currentValue) / elapsed;
  const paceWeight = paceWeightFor(input.family, elapsed);

  if (baseline <= 0) {
    return {
      projection: observedFullGamePace,
      paceWeight,
    };
  }

  // Current pace matters more as the game develops, but a single explosive
  // play should not turn an early-game projection into an absurd extrapolation.
  const cappedObservedPace = clamp(
    observedFullGamePace,
    baseline * 0.3,
    baseline * 3,
  );
  return {
    projection:
      baseline * (1 - paceWeight) + cappedObservedPace * paceWeight,
    paceWeight,
  };
}

export function conditionalLivePlayerProbability(input: {
  family: MarketFamily;
  direction: Direction;
  threshold: number;
  currentValue: number;
  baselineFullGameProjection: number;
  fullGameStdDev: number;
  remainingFraction: number;
  opportunityRemainingFraction?: number;
  remainingRateMultiplier?: number;
}): LivePlayerConditionalEstimate | null {
  const remaining = clamp(input.remainingFraction, 0.001, 1);
  const current = Math.max(0, input.currentValue);
  const baseline = Math.max(0, input.baselineFullGameProjection);
  const opportunityRemaining = clamp(
    input.opportunityRemainingFraction ?? remaining,
    remaining,
    1,
  );
  const remainingRateMultiplier = clamp(
    input.remainingRateMultiplier ?? 1,
    0,
    1.5,
  );
  const pace = paceAdjustedProjection({
    family: input.family,
    currentValue: current,
    baselineFullGameProjection: baseline,
    remainingFraction: remaining,
  });

  if (input.family === "longest_reception") {
    if (current >= input.threshold) {
      const overProbability = 0.999;
      return {
        probability:
          input.direction === "under" ? 1 - overProbability : overProbability,
        projectedFinal: current,
        expectedRemaining: 0,
        remainingStdDev: null,
        paceAdjustedFullGameProjection: pace.projection,
        paceWeight: pace.paceWeight,
      };
    }

    const fullGameOver =
      1 -
      normalCdf(
        input.threshold,
        Math.max(pace.projection, baseline),
        Math.max(1, input.fullGameStdDev),
      );
    const opportunityFraction =
      opportunityRemaining * remainingRateMultiplier;
    const remainingOver =
      1 - Math.pow(1 - clamp(fullGameOver, 0.001, 0.999), opportunityFraction);
    return {
      probability:
        input.direction === "under" ? 1 - remainingOver : remainingOver,
      projectedFinal: current,
      expectedRemaining: 0,
      remainingStdDev: null,
      paceAdjustedFullGameProjection: pace.projection,
      paceWeight: pace.paceWeight,
    };
  }

  const expectedRemaining =
    pace.projection * opportunityRemaining * remainingRateMultiplier;
  const projectedFinal = current + expectedRemaining;
  let overProbability: number;

  if (poissonFamilies.has(input.family)) {
    const target = Math.ceil(input.threshold);
    const additionalNeeded = Math.max(0, target - current);
    overProbability =
      additionalNeeded <= 0
        ? 0.999
        : poissonAtLeastProbability(additionalNeeded, expectedRemaining);
  } else {
    const boundary =
      input.family === "receptions" && Number.isInteger(input.threshold)
        ? input.threshold - 0.5
        : input.threshold;
    const effectiveRemaining = Math.max(
      opportunityRemaining * remainingRateMultiplier,
      0,
    );
    const volatilityExponent = remainingVolatilityExponent(input.family);
    const remainingStdDev =
      remainingRateMultiplier <= 0
        ? input.family === "receptions"
          ? 0.25
          : 0.5
        : Math.max(
            input.family === "receptions" ? 0.75 : 1,
            input.fullGameStdDev *
              Math.pow(Math.max(effectiveRemaining, 0.001), volatilityExponent),
          );
    overProbability =
      1 - normalCdf(boundary, projectedFinal, remainingStdDev);

    return {
      probability: clamp(
        input.direction === "under" ? 1 - overProbability : overProbability,
        0.001,
        0.999,
      ),
      projectedFinal,
      expectedRemaining,
      remainingStdDev,
      paceAdjustedFullGameProjection: pace.projection,
      paceWeight: pace.paceWeight,
    };
  }

  return {
    probability: clamp(
      input.direction === "under" ? 1 - overProbability : overProbability,
      0.001,
      0.999,
    ),
    projectedFinal,
    expectedRemaining,
    remainingStdDev: null,
    paceAdjustedFullGameProjection: pace.projection,
    paceWeight: pace.paceWeight,
  };
}
