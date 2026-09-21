import {
  PLAYER_REGULAR_SEASON_HISTORY,
  type StaticPlayerHistory,
} from "@/data/player-regular-season-history";
import type { MarketFamily } from "@/lib/markets/types";
import { clamp } from "@/lib/utils";

type SkillPosition = "QB" | "RB" | "WR" | "TE" | null;
type PriorGroup =
  | "qb_pass"
  | "qb_rush"
  | "rb_rush"
  | "receiver_rush"
  | "rb_receiving_yards"
  | "receiver_receiving_yards"
  | "rb_receptions"
  | "receiver_receptions";

interface PriorSample {
  mean: number;
  stdDev: number;
  games: number;
}

export interface PlayerVarianceEstimate {
  stdDev: number;
  priorStdDev: number;
  observedStdDev: number | null;
  playerHistoryWeight: number;
  priorSampleSize: number;
  priorSeason: number;
}

const PRIOR_SEASON = 2025;
let priorSamples: Map<PriorGroup, PriorSample[]> | null = null;

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStdDev(values: number[]) {
  if (values.length < 2) return null;
  const average = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    (values.length - 1);
  return Number.isFinite(variance)
    ? Math.sqrt(Math.max(variance, 0))
    : null;
}

function seasonGames(player: StaticPlayerHistory, season: number) {
  return player.g.filter((game) => (game[0] ?? 0) === season);
}

function valuesFromGames(games: number[][], index: number) {
  return games.map((game) => game[index] ?? 0);
}

function inferredRole(games: number[][]) {
  const passing = mean(valuesFromGames(games, 2));
  const rushing = mean(valuesFromGames(games, 4));
  const receiving = mean(valuesFromGames(games, 5));

  if (passing > 30) return "QB" as const;
  if (rushing > Math.max(8, receiving * 0.7)) return "RB" as const;
  return "RECEIVER" as const;
}

function addSample(
  map: Map<PriorGroup, PriorSample[]>,
  group: PriorGroup,
  values: number[],
) {
  const stdDev = sampleStdDev(values);
  if (stdDev === null || !Number.isFinite(stdDev)) return;
  const average = mean(values);
  const row = {
    mean: average,
    stdDev,
    games: values.length,
  };
  map.set(group, [...(map.get(group) ?? []), row]);
}

function buildPriorSamples() {
  if (priorSamples) return priorSamples;

  const map = new Map<PriorGroup, PriorSample[]>();

  for (const player of Object.values(PLAYER_REGULAR_SEASON_HISTORY)) {
    const games = seasonGames(player, PRIOR_SEASON);
    if (games.length < 4) continue;

    const role = inferredRole(games);
    const passing = valuesFromGames(games, 2);
    const rushing = valuesFromGames(games, 4);
    const receiving = valuesFromGames(games, 5);
    const receptions = valuesFromGames(games, 6);

    if (role === "QB") {
      addSample(map, "qb_pass", passing);
      addSample(map, "qb_rush", rushing);
    } else if (role === "RB") {
      addSample(map, "rb_rush", rushing);
      addSample(map, "rb_receiving_yards", receiving);
      addSample(map, "rb_receptions", receptions);
    } else {
      addSample(map, "receiver_rush", rushing);
      addSample(map, "receiver_receiving_yards", receiving);
      addSample(map, "receiver_receptions", receptions);
    }
  }

  priorSamples = map;
  return map;
}

function groupFor(
  family: MarketFamily,
  position: SkillPosition,
): PriorGroup | null {
  if (family === "passing_yards") return "qb_pass";

  if (family === "rushing_yards") {
    if (position === "QB") return "qb_rush";
    if (position === "RB") return "rb_rush";
    return "receiver_rush";
  }

  if (family === "receiving_yards") {
    if (position === "RB") return "rb_receiving_yards";
    return "receiver_receiving_yards";
  }

  if (family === "receptions") {
    if (position === "RB") return "rb_receptions";
    return "receiver_receptions";
  }

  return null;
}

function fallbackPrior(
  family: MarketFamily,
  projection: number,
  position: SkillPosition,
) {
  const expected = Math.max(0, projection);

  if (family === "passing_yards") {
    return clamp(28 + expected * 0.18, 42, 92);
  }
  if (family === "rushing_yards") {
    if (position === "QB") {
      return clamp(4 + expected * 0.5, 3.5, 32);
    }
    if (position === "RB") {
      return clamp(11 + expected * 0.38, 9, 55);
    }
    return clamp(1.5 + expected * 1.2, 1.5, 24);
  }
  if (family === "receiving_yards") {
    if (position === "RB") {
      return clamp(3.5 + expected * 0.7, 3, 38);
    }
    const receiver = clamp(2.5 + expected * 0.58, 2, 48);
    return position === "TE" ? receiver * 0.94 : receiver;
  }
  if (family === "receptions") {
    const base =
      position === "RB"
        ? 0.5 + expected * 0.42
        : 0.45 + expected * 0.38;
    return clamp(position === "TE" ? base * 0.96 : base, 0.4, 3.4);
  }
  if (family === "longest_reception") {
    return clamp(3 + expected * 0.42, 3.5, 18);
  }

  return Math.max(1, expected * 0.35);
}

function weightedMedian(
  rows: Array<{ value: number; weight: number }>,
) {
  const sorted = rows
    .filter((row) => Number.isFinite(row.value) && row.weight > 0)
    .toSorted((first, second) => first.value - second.value);
  const total = sorted.reduce((sum, row) => sum + row.weight, 0);
  if (!sorted.length || total <= 0) return null;

  let cumulative = 0;
  for (const row of sorted) {
    cumulative += row.weight;
    if (cumulative >= total / 2) return row.value;
  }
  return sorted.at(-1)?.value ?? null;
}

function empiricalPrior(
  family: MarketFamily,
  projection: number,
  position: SkillPosition,
) {
  const group = groupFor(family, position);
  if (!group) {
    return {
      stdDev: fallbackPrior(family, projection, position),
      sampleSize: 0,
    };
  }

  const rows = buildPriorSamples().get(group) ?? [];
  if (rows.length < 8) {
    return {
      stdDev: fallbackPrior(family, projection, position),
      sampleSize: rows.length,
    };
  }

  const expected = Math.max(0, projection);
  const floorBandwidth =
    family === "passing_yards"
      ? 45
      : family === "receptions"
        ? 0.8
        : 6;
  const bandwidth = Math.max(
    floorBandwidth,
    expected * (family === "receptions" ? 0.35 : 0.38),
  );

  const weighted = rows
    .map((row) => {
      const distance = Math.abs(row.mean - expected);
      const kernel = Math.exp(
        -0.5 * (distance / Math.max(bandwidth, 0.1)) ** 2,
      );
      const gamesWeight = clamp(row.games / 12, 0.35, 1.2);
      return {
        value: row.stdDev,
        weight: kernel * gamesWeight,
        distance,
      };
    })
    .filter((row) => row.weight > 0.015)
    .toSorted((first, second) => first.distance - second.distance)
    .slice(0, 90);

  const median = weightedMedian(weighted);
  if (median === null) {
    return {
      stdDev: fallbackPrior(family, projection, position),
      sampleSize: 0,
    };
  }

  // Keep the kernel estimate anchored to a smooth fallback at the extreme
  // tails where 2025 has fewer comparable players.
  const effectiveSample = weighted.reduce((sum, row) => sum + row.weight, 0);
  const empiricalWeight = clamp(effectiveSample / 16, 0.45, 0.9);
  const fallback = fallbackPrior(family, projection, position);
  let stdDev =
    median * empiricalWeight + fallback * (1 - empiricalWeight);

  // The historical receiver pool contains both WRs and TEs. Preserve the
  // empirical production curve, then apply a small position-specific modifier
  // instead of pretending those two roles have identical volatility.
  if (
    position === "TE" &&
    (family === "receiving_yards" || family === "receptions")
  ) {
    stdDev *= 0.94;
  }

  return {
    stdDev: Math.max(0.35, stdDev),
    sampleSize: weighted.length,
  };
}

export function estimatePlayerStatStdDev(input: {
  family: MarketFamily;
  projection: number;
  position: SkillPosition;
  currentSeasonValues: number[];
}): PlayerVarianceEstimate {
  const prior = empiricalPrior(
    input.family,
    input.projection,
    input.position,
  );
  const observed =
    input.currentSeasonValues.length >= 4
      ? sampleStdDev(input.currentSeasonValues)
      : null;

  // Treat the 2025 projection/position curve as roughly eight games of prior
  // information. The player's own 2026 variance starts contributing after
  // Game 4 and gains weight after every completed game.
  const games = input.currentSeasonValues.length;
  const playerHistoryWeight =
    observed === null
      ? 0
      : clamp((games - 3) / ((games - 3) + 8), 0, 0.74);

  const blended =
    observed === null
      ? prior.stdDev
      : prior.stdDev * (1 - playerHistoryWeight) +
        observed * playerHistoryWeight;

  return {
    stdDev: clamp(blended, prior.stdDev * 0.45, prior.stdDev * 1.9),
    priorStdDev: prior.stdDev,
    observedStdDev: observed,
    playerHistoryWeight,
    priorSampleSize: prior.sampleSize,
    priorSeason: PRIOR_SEASON,
  };
}
